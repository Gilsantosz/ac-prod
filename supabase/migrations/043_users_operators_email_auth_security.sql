-- AC.Prod — usuários, operadores, e-mail e autenticação segura

-- 1. Impede que um usuário comum eleve o próprio papel/permissões.
CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF OLD.id <> auth.uid() THEN
    RAISE EXCEPTION 'Você só pode atualizar o próprio perfil.';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.cell IS DISTINCT FROM OLD.cell
    OR NEW.permissions IS DISTINCT FROM OLD.permissions
    OR NEW.active IS DISTINCT FROM OLD.active
    OR NEW.receives_alerts IS DISTINCT FROM OLD.receives_alerts
    OR NEW.receives_daily_report IS DISTINCT FROM OLD.receives_daily_report
    OR NEW.receives_trace_report IS DISTINCT FROM OLD.receives_trace_report
    OR NEW.receives_shipping_report IS DISTINCT FROM OLD.receives_shipping_report
    OR NEW.report_send_time IS DISTINCT FROM OLD.report_send_time
    OR NEW.report_frequency IS DISTINCT FROM OLD.report_frequency
    OR NEW.extra_emails IS DISTINCT FROM OLD.extra_emails
    OR NEW.managed_cells IS DISTINCT FROM OLD.managed_cells
    OR NEW.report_delivery_enabled IS DISTINCT FROM OLD.report_delivery_enabled
    OR NEW.permission_version IS DISTINCT FROM OLD.permission_version
    OR NEW.access_scope IS DISTINCT FROM OLD.access_scope
  THEN
    RAISE EXCEPTION 'Campos de acesso só podem ser alterados por um administrador.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_security_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_security_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_security_fields();

REVOKE ALL ON FUNCTION public.protect_profile_security_fields() FROM PUBLIC, anon, authenticated;

-- 2. Fonte oficial de destinatários usada pela IA.
CREATE OR REPLACE VIEW public.ai_email_recipients
WITH (security_invoker = true) AS
SELECT
  ('profile:' || p.id::text) AS ref_id,
  p.id AS profile_id,
  NULL::uuid AS report_recipient_id,
  'profile'::text AS source,
  COALESCE(NULLIF(p.name, ''), p.email) AS name,
  lower(p.email) AS email,
  CASE
    WHEN p.role = 'admin' THEN 'Administrador'
    WHEN p.role = 'manager' THEN 'Gestor'
    WHEN p.role = 'supervisor' THEN 'Supervisor'
    ELSE 'Destinatário autorizado'
  END AS role_label,
  COALESCE(p.managed_cells, '{}'::text[]) AS cell_filter,
  COALESCE(p.active, true) AS active
FROM public.profiles p
WHERE COALESCE(p.active, true) = true
  AND (p.role IN ('admin', 'manager', 'supervisor') OR p.report_delivery_enabled = true)
  AND p.email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'

UNION ALL

SELECT
  ('recipient:' || r.id::text),
  NULL::uuid,
  r.id,
  'report_recipients'::text,
  COALESCE(NULLIF(r.name, ''), r.email),
  lower(r.email),
  COALESCE(r.role_label, 'Destinatário IA'),
  COALESCE(r.cell_filter, '{}'::text[]),
  COALESCE(r.active, true)
FROM public.report_recipients r
WHERE COALESCE(r.active, true) = true
  AND r.email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$';

GRANT SELECT ON public.ai_email_recipients TO authenticated;

DROP POLICY IF EXISTS profiles_ai_recipient_read ON public.profiles;
CREATE POLICY profiles_ai_recipient_read
ON public.profiles FOR SELECT TO authenticated
USING (
  (
    public.has_permission('ai_operations')
    OR public.has_permission('send_reports')
    OR public.has_permission('schedule_reports')
    OR public.has_permission('manage_report_recipients')
  )
  AND COALESCE(active, true) = true
  AND (role IN ('admin', 'manager', 'supervisor') OR report_delivery_enabled = true)
);

DROP POLICY IF EXISTS report_recipients_ai_read ON public.report_recipients;
CREATE POLICY report_recipients_ai_read
ON public.report_recipients FOR SELECT TO authenticated
USING (
  public.has_permission('ai_operations')
  OR public.has_permission('send_reports')
  OR public.has_permission('schedule_reports')
  OR public.has_permission('manage_report_recipients')
);

-- 3. Calcula a próxima execução no fuso configurado; um agendamento novo não
--    deve ser enviado imediatamente apenas porque next_run_at estava nulo.
CREATE OR REPLACE FUNCTION public.compute_report_next_run(
  p_frequency text,
  p_time_local time,
  p_timezone text DEFAULT 'America/Sao_Paulo',
  p_from timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_now timestamp := p_from AT TIME ZONE p_timezone;
  v_candidate timestamp;
BEGIN
  v_candidate := date_trunc('day', v_local_now) + p_time_local;

  IF p_frequency = 'monthly' THEN
    IF v_candidate <= v_local_now THEN
      v_candidate := v_candidate + interval '1 month';
    END IF;
  ELSIF p_frequency = 'weekly' THEN
    IF v_candidate <= v_local_now THEN
      v_candidate := v_candidate + interval '7 days';
    END IF;
  ELSE
    IF v_candidate <= v_local_now THEN
      v_candidate := v_candidate + interval '1 day';
    END IF;
    IF p_frequency = 'workdays' THEN
      WHILE extract(isodow FROM v_candidate) IN (6, 7) LOOP
        v_candidate := v_candidate + interval '1 day';
      END LOOP;
    END IF;
  END IF;

  RETURN v_candidate AT TIME ZONE p_timezone;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_report_schedule_next_run()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW.next_run_at IS NULL
    OR NEW.time_local IS DISTINCT FROM OLD.time_local
    OR NEW.frequency IS DISTINCT FROM OLD.frequency
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
  THEN
    NEW.next_run_at := public.compute_report_next_run(
      NEW.frequency,
      NEW.time_local,
      COALESCE(NULLIF(NEW.timezone, ''), 'America/Sao_Paulo'),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_schedule_next_run ON public.report_schedules;
CREATE TRIGGER trg_report_schedule_next_run
BEFORE INSERT OR UPDATE OF time_local, frequency, timezone, next_run_at
ON public.report_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_report_schedule_next_run();

UPDATE public.report_schedules
SET next_run_at = public.compute_report_next_run(
  frequency,
  time_local,
  COALESCE(NULLIF(timezone, ''), 'America/Sao_Paulo'),
  now()
)
WHERE enabled = true AND next_run_at IS NULL;

-- 4. Preserva o nome do operador no histórico antes de permitir exclusão real.
ALTER TABLE public.packing_scans ADD COLUMN IF NOT EXISTS operator_name_snapshot text;
ALTER TABLE public.production_collection_events ADD COLUMN IF NOT EXISTS operator_name_snapshot text;
ALTER TABLE public.production_entries ADD COLUMN IF NOT EXISTS operator_name_snapshot text;
ALTER TABLE public.production_events ADD COLUMN IF NOT EXISTS operator_name_snapshot text;
ALTER TABLE public.production_stage_readings ADD COLUMN IF NOT EXISTS operator_name_snapshot text;
ALTER TABLE public.shipment_scans ADD COLUMN IF NOT EXISTS operator_name_snapshot text;

CREATE OR REPLACE FUNCTION public.snapshot_operator_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.operator_id IS NOT NULL AND NULLIF(NEW.operator_name_snapshot, '') IS NULL THEN
    SELECT name INTO NEW.operator_name_snapshot
    FROM public.operators
    WHERE id = NEW.operator_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_operator_name() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'packing_scans', 'production_collection_events', 'production_entries',
    'production_events', 'production_stage_readings', 'shipment_scans'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_snapshot_operator_name ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_snapshot_operator_name BEFORE INSERT OR UPDATE OF operator_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.snapshot_operator_name()',
      v_table
    );
    EXECUTE format(
      'UPDATE public.%I h SET operator_name_snapshot = o.name FROM public.operators o WHERE h.operator_id = o.id AND NULLIF(h.operator_name_snapshot, '''') IS NULL',
      v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_operator(
  p_operator_id uuid,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator public.operators%ROWTYPE;
  v_actor_name text;
  v_actor_email text;
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir operadores.';
  END IF;

  SELECT * INTO v_operator
  FROM public.operators
  WHERE id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador não encontrado.';
  END IF;

  IF btrim(COALESCE(p_confirmation, '')) <> v_operator.name THEN
    RAISE EXCEPTION 'Confirmação inválida. Digite exatamente o nome do operador.';
  END IF;

  SELECT name, email INTO v_actor_name, v_actor_email
  FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.system_audit_logs (
    user_id, user_name, user_email, user_role, action, entity,
    entity_id, entity_label, page, route, method, old_value, success
  ) VALUES (
    auth.uid(), v_actor_name, v_actor_email, 'admin', 'delete', 'operator',
    v_operator.id::text, v_operator.name, 'Gestão de Operadores', '/operadores',
    'RPC', jsonb_build_object('name', v_operator.name, 'login_name', v_operator.login_name), true
  );

  DELETE FROM public.operators WHERE id = p_operator_id;

  RETURN jsonb_build_object('success', true, 'deleted_id', p_operator_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_operator(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_operator(uuid, text) TO authenticated;

-- 5. Exclusão de usuários com proteção contra autoexclusão e último admin.
CREATE OR REPLACE FUNCTION public.delete_user_from_auth(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_target_role text;
  v_target_email text;
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'Permissão insuficiente: apenas administradores podem excluir usuários.';
  END IF;
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode excluir a própria conta.';
  END IF;

  SELECT role, email INTO v_target_role, v_target_email
  FROM public.profiles WHERE id = target_user_id;

  IF v_target_role = 'admin'
    AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND active IS DISTINCT FROM false) <= 1
  THEN
    RAISE EXCEPTION 'O último administrador ativo não pode ser excluído.';
  END IF;

  INSERT INTO public.system_audit_logs (
    user_id, user_role, action, entity, entity_id, entity_label,
    page, route, method, old_value, success
  ) VALUES (
    auth.uid(), 'admin', 'delete', 'profile', target_user_id::text, v_target_email,
    'Usuários', '/usuarios', 'RPC', jsonb_build_object('email', v_target_email, 'role', v_target_role), true
  );

  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_from_auth(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_from_auth(uuid) TO authenticated;

-- 6. Restringe RPCs administrativas e segredos do Promob.
REVOKE ALL ON FUNCTION public.admin_upsert_operator(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_unlock_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlock_operator(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reset_production_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_production_data() TO authenticated;
REVOKE ALL ON FUNCTION public.store_promob_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_promob_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_promob_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_promob_token(uuid) TO service_role;

-- Leituras de vínculos de operador não devem ficar abertas ao papel anônimo.
DROP POLICY IF EXISTS policy_select_own_cell_assignments ON public.operator_cell_assignments;
CREATE POLICY policy_authenticated_select_cell_assignments
ON public.operator_cell_assignments FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS policy_select_own_machine_assignments ON public.operator_machine_assignments;
CREATE POLICY policy_authenticated_select_machine_assignments
ON public.operator_machine_assignments FOR SELECT TO authenticated
USING (true);

-- Logs de entrega só são gravados pelas Edge Functions com service role.
DROP POLICY IF EXISTS delivery_logs_insert ON public.report_delivery_logs;

-- 7. Protege a chamada do cron sem manter o segredo no repositório.
CREATE TABLE IF NOT EXISTS public.internal_edge_secrets (
  name text PRIMARY KEY,
  secret_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_edge_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_edge_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.internal_edge_secrets TO service_role;

CREATE OR REPLACE FUNCTION public.verify_report_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT length(COALESCE(p_secret, '')) >= 32
    AND EXISTS (
      SELECT 1
      FROM public.internal_edge_secrets
      WHERE name = 'send-scheduled-reports'
        AND secret_hash = extensions.digest(p_secret, 'sha256')
    );
$$;

REVOKE ALL ON FUNCTION public.verify_report_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_report_cron_secret(text) TO service_role;

DO $$
DECLARE
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_job_id bigint;
BEGIN
  INSERT INTO public.internal_edge_secrets(name, secret_hash, rotated_at)
  VALUES ('send-scheduled-reports', extensions.digest(v_secret, 'sha256'), now())
  ON CONFLICT (name) DO UPDATE
    SET secret_hash = EXCLUDED.secret_hash,
        rotated_at = now();

  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'run-send-scheduled-reports' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'run-send-scheduled-reports',
    '*/10 * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := 'https://uozuzdfvnufsjsonswag.supabase.co/functions/v1/send-scheduled-reports',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb
      );
      $cron$,
      v_secret
    )
  );
END;
$$;

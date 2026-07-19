-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 039: Reconexão de Usuários, Fechamento por E-mail, IA e RBAC
-- ============================================================

-- ─── 1. Evolução de profiles ─────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS report_delivery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permission_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS access_scope jsonb NOT NULL DEFAULT '{}';

-- Atualiza a restrição de papéis para aceitar supervisor, viewer, user
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['admin'::text, 'operator'::text, 'manager'::text, 'supervisor'::text, 'viewer'::text, 'user'::text]));

-- Backfill: Habilitar e-mails para gestores e admins
UPDATE public.profiles
SET report_delivery_enabled = true
WHERE role IN ('admin', 'manager') AND active = true;

-- ─── 2. Tabelas Relacionais de Agendamento de Relatórios ──────
CREATE TABLE IF NOT EXISTS public.report_schedule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.report_schedules(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  external_email text,
  recipient_name_snapshot text,
  recipient_email_snapshot text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT chk_recipient_type CHECK (
    (profile_id IS NOT NULL AND external_email IS NULL) OR
    (profile_id IS NULL AND external_email IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_schedule_profile 
  ON public.report_schedule_recipients(schedule_id, profile_id) 
  WHERE profile_id IS NOT NULL AND active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_schedule_email 
  ON public.report_schedule_recipients(schedule_id, LOWER(TRIM(external_email))) 
  WHERE external_email IS NOT NULL AND active = true;

-- ─── 3. Grupos de E-mail Persistidos no Banco ──────────────────
CREATE TABLE IF NOT EXISTS public.email_recipient_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_recipient_groups_name 
  ON public.email_recipient_groups(LOWER(TRIM(name))) 
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.email_recipient_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.email_recipient_groups(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  external_email text,
  recipient_name_snapshot text,
  recipient_email_snapshot text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT chk_group_member_type CHECK (
    (profile_id IS NOT NULL AND external_email IS NULL) OR
    (profile_id IS NULL AND external_email IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_member_profile 
  ON public.email_recipient_group_members(group_id, profile_id) 
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_member_email 
  ON public.email_recipient_group_members(group_id, LOWER(TRIM(external_email))) 
  WHERE external_email IS NOT NULL;

-- ─── 4. Execuções Idempotentes (Runs e Deliveries) ───────────
CREATE TABLE IF NOT EXISTS public.report_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.report_schedules(id) ON DELETE SET NULL,
  report_job_id uuid REFERENCES public.report_jobs(id) ON DELETE SET NULL,
  trigger_source text NOT NULL, -- 'scheduled', 'manual', 'ai', 'test', 'retry'
  scheduled_for timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  status text NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'sent', 'partial', 'failed', 'skipped'
  idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  lock_token text,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  report_snapshot jsonb,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.report_schedule_runs(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.report_schedules(id) ON DELETE SET NULL,
  report_job_id uuid REFERENCES public.report_jobs(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_name_snapshot text,
  recipient_email_snapshot text NOT NULL,
  recipient_email_normalized text NOT NULL,
  provider text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued', -- 'queued', 'sent', 'failed', 'skipped'
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_deliveries_run_email 
  ON public.report_deliveries(run_id, recipient_email_normalized);

-- ─── 5. Evolução de report_schedules ──────────────────────────
ALTER TABLE public.report_schedules
  ADD COLUMN IF NOT EXISTS source_page text,
  ADD COLUMN IF NOT EXISTS period_mode text DEFAULT 'current_day',
  ADD COLUMN IF NOT EXISTS shift_filter text[],
  ADD COLUMN IF NOT EXISTS days_of_week smallint[],
  ADD COLUMN IF NOT EXISTS month_day smallint,
  ADD COLUMN IF NOT EXISTS grace_minutes integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS send_when_empty boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id);

-- ─── 6. Backfill de Destinatários de Schedules Existentes ─────
DO $$
DECLARE
  v_rec RECORD;
  v_prof_id uuid;
  v_email text;
BEGIN
  FOR v_rec IN SELECT id, recipient_profile_ids, extra_emails FROM public.report_schedules LOOP
    -- profiles internos
    IF v_rec.recipient_profile_ids IS NOT NULL AND array_length(v_rec.recipient_profile_ids, 1) > 0 THEN
      FOR i IN 1..array_length(v_rec.recipient_profile_ids, 1) LOOP
        BEGIN
          v_prof_id := v_rec.recipient_profile_ids[i]::uuid;
          SELECT email INTO v_email FROM public.profiles WHERE id = v_prof_id;
          IF v_email IS NOT NULL THEN
            INSERT INTO public.report_schedule_recipients (schedule_id, profile_id, recipient_name_snapshot, recipient_email_snapshot, active)
            VALUES (v_rec.id, v_prof_id, v_email, v_email, true)
            ON CONFLICT DO NOTHING;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- Ignorar ids mal formatados ou deletados
        END;
      END LOOP;
    END IF;

    -- e-mails adicionais
    IF v_rec.extra_emails IS NOT NULL AND array_length(v_rec.extra_emails, 1) > 0 THEN
      FOR i IN 1..array_length(v_rec.extra_emails, 1) LOOP
        v_email := TRIM(v_rec.extra_emails[i]);
        IF v_email IS NOT NULL AND v_email LIKE '%@%' THEN
          INSERT INTO public.report_schedule_recipients (schedule_id, external_email, recipient_name_snapshot, recipient_email_snapshot, active)
          VALUES (v_rec.id, v_email, v_email, v_email, true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ─── 7. View Unificada do Histórico de Entregas ────────────────
CREATE OR REPLACE VIEW public.report_delivery_history AS
SELECT
  d.id,
  d.run_id,
  d.schedule_id,
  d.report_job_id,
  d.profile_id,
  d.recipient_name_snapshot AS recipient_name,
  d.recipient_email_snapshot AS recipient_email,
  d.recipient_email_normalized,
  d.provider,
  d.provider_message_id,
  d.status,
  d.error_message,
  d.attempt_count,
  d.sent_at,
  d.created_at
FROM public.report_deliveries d
UNION ALL
-- Logs legados de report_delivery_logs
SELECT
  l.id,
  NULL::uuid AS run_id,
  l.report_schedule_id AS schedule_id,
  NULL::uuid AS report_job_id,
  NULL::uuid AS profile_id,
  NULL::text AS recipient_name,
  l.recipient_email,
  LOWER(TRIM(l.recipient_email)) AS recipient_email_normalized,
  NULL::text AS provider,
  NULL::text AS provider_message_id,
  l.status,
  l.error_message,
  1 AS attempt_count,
  l.sent_at,
  l.created_at
FROM public.report_delivery_logs l
UNION ALL
-- Logs legados de report_email_logs
SELECT
  e.id,
  NULL::uuid AS run_id,
  e.scheduled_report_id AS schedule_id,
  e.report_job_id,
  e.recipient_id AS profile_id,
  NULL::text AS recipient_name,
  e.recipient_email,
  LOWER(TRIM(e.recipient_email)) AS recipient_email_normalized,
  e.provider,
  e.provider_message_id,
  e.status,
  e.error_message,
  1 AS attempt_count,
  e.sent_at,
  e.created_at
FROM public.report_email_logs e;

-- ─── 8. Funções e RPCs de Segurança e RBAC ────────────────────

-- Função central de permissão no banco
CREATE OR REPLACE FUNCTION public.has_permission(p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_permissions jsonb;
  v_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, permissions, active INTO v_role, v_permissions, v_active
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_active = false THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  RETURN COALESCE((v_permissions ->> p_permission_key)::boolean, false);
END;
$$;

-- RPC para reivindicar schedules vencidos de forma concorrente e segura
CREATE OR REPLACE FUNCTION public.claim_due_report_schedules(
  p_lock_token text,
  p_lock_duration interval DEFAULT interval '10 minutes'
)
RETURNS TABLE (
  run_id uuid,
  schedule_id uuid,
  name text,
  report_types text[],
  format text,
  cell_filter text[],
  period_mode text,
  shift_filter text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_rounded_now timestamptz := date_trunc('minute', v_now);
  v_schedule RECORD;
  v_idempotency_key text;
  v_run_id uuid;
BEGIN
  -- Procure schedules ativos e vencidos
  FOR v_schedule IN
    SELECT s.id, s.name, s.report_types, s.report_type, s.format, s.cell_filter, s.period_mode, s.shift_filter, s.next_run_at
    FROM public.report_schedules s
    WHERE s.enabled = true
      AND (s.next_run_at IS NULL OR s.next_run_at <= v_now)
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Calcular a data pretendida do agendamento (usa next_run_at ou o momento atual se for nulo)
    v_idempotency_key := 'scheduled:' || v_schedule.id || ':' || to_char(COALESCE(v_schedule.next_run_at, v_rounded_now), 'YYYY-MM-DD HH24:MI:SS"Z"');
    
    -- Tenta criar a execução de forma atômica
    INSERT INTO public.report_schedule_runs (
      schedule_id,
      trigger_source,
      scheduled_for,
      period_start,
      period_end,
      status,
      idempotency_key,
      locked_at,
      lock_token,
      started_at,
      created_at,
      updated_at
    ) VALUES (
      v_schedule.id,
      'scheduled',
      COALESCE(v_schedule.next_run_at, v_rounded_now),
      v_now - interval '1 day',
      v_now,
      'processing',
      v_idempotency_key,
      v_now,
      p_lock_token,
      v_now,
      v_now,
      v_now
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_run_id;

    IF v_run_id IS NOT NULL THEN
      run_id := v_run_id;
      schedule_id := v_schedule.id;
      name := v_schedule.name;
      report_types := COALESCE(v_schedule.report_types, ARRAY[v_schedule.report_type]);
      format := v_schedule.format;
      cell_filter := v_schedule.cell_filter;
      period_mode := COALESCE(v_schedule.period_mode, 'current_day');
      shift_filter := v_schedule.shift_filter;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ─── 9. Políticas de Segurança (RLS) ─────────────────────────
ALTER TABLE public.report_schedule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_recipient_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_recipient_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_admin_all_schedule_recipients ON public.report_schedule_recipients
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_permission('manage_report_recipients'));

CREATE POLICY policy_select_own_schedule_recipients ON public.report_schedule_recipients
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY policy_admin_all_groups ON public.email_recipient_groups
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_permission('manage_report_recipients'));

CREATE POLICY policy_select_groups ON public.email_recipient_groups
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY policy_admin_all_group_members ON public.email_recipient_group_members
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_permission('manage_report_recipients'));

CREATE POLICY policy_select_group_members ON public.email_recipient_group_members
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY policy_admin_all_runs ON public.report_schedule_runs
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_permission('view_report_delivery_logs'));

CREATE POLICY policy_select_runs ON public.report_schedule_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY policy_admin_all_deliveries ON public.report_deliveries
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.has_permission('view_report_delivery_logs'));

CREATE POLICY policy_select_deliveries ON public.report_deliveries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- Permissões de grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_schedule_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_recipient_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_recipient_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_schedule_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_deliveries TO authenticated;

GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_due_report_schedules(text, interval) TO authenticated;

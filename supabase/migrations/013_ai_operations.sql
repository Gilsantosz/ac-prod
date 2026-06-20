-- ============================================================
-- AC.Prod - Copilot Industrial e operacoes de relatorios
-- Estrutura aditiva, auditavel e protegida por RLS.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION has_ai_permission(permission_name text DEFAULT 'ai_operations')
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND active IS DISTINCT FROM false
      AND (
        role IN ('admin', 'manager')
        OR COALESCE((permissions ->> permission_name)::boolean, false)
        OR (permission_name = 'ai_operations' AND COALESCE((permissions ->> 'view_reports')::boolean, false))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE TABLE IF NOT EXISTS ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  request_type text NOT NULL DEFAULT 'question'
    CHECK (request_type IN ('question','insight','report','navigation','lot_lookup')),
  prompt text NOT NULL,
  normalized_intent text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary text,
  source_tables text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','processing','completed','failed','denied')),
  error_message text,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  title text NOT NULL,
  report_type text NOT NULL DEFAULT 'production_summary',
  format text NOT NULL DEFAULT 'pdf'
    CHECK (format IN ('pdf','xlsx','csv','html')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  storage_path text,
  file_name text,
  mime_type text,
  error_message text,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  role_label text,
  recipient_group text NOT NULL DEFAULT 'manager'
    CHECK (recipient_group IN ('manager','cell','lot','alert','other')),
  cell_filter text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email, recipient_group)
);

CREATE TABLE IF NOT EXISTS report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  audience text NOT NULL DEFAULT 'manager'
    CHECK (audience IN ('manager','lot','cell','alert')),
  subject_template text NOT NULL,
  html_template text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  system_template boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  report_type text NOT NULL DEFAULT 'production_summary',
  format text NOT NULL DEFAULT 'pdf'
    CHECK (format IN ('pdf','xlsx','csv','html')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_ids uuid[] NOT NULL DEFAULT '{}',
  template_id uuid REFERENCES report_templates(id) ON DELETE SET NULL,
  frequency text NOT NULL DEFAULT 'daily'
    CHECK (frequency IN ('once','daily','workdays','weekly','monthly')),
  time_local time NOT NULL DEFAULT '07:00:00',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  weekday smallint CHECK (weekday BETWEEN 0 AND 6),
  month_day smallint CHECK (month_day BETWEEN 1 AND 31),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_job_id uuid REFERENCES report_jobs(id) ON DELETE SET NULL,
  scheduled_report_id uuid REFERENCES scheduled_reports(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES report_recipients(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  provider text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','failed','skipped')),
  error_message text,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  trace_id uuid,
  level text NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug','info','warning','error','security')),
  event text NOT NULL,
  entity text,
  entity_id text,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend'
    CHECK (provider IN ('resend','smtp','disabled')),
  sender_name text NOT NULL DEFAULT 'Leo Madeiras - AC.Prod',
  sender_email text,
  reply_to text,
  encrypted_secret_ref text,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_user_created ON ai_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_trace ON ai_requests(trace_id);
CREATE INDEX IF NOT EXISTS idx_report_jobs_user_created ON report_jobs(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON report_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_email_logs_created ON report_email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_email_logs_status ON report_email_logs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run ON scheduled_reports(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_ai_system_logs_created ON ai_system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_system_logs_trace ON ai_system_logs(trace_id);

DROP TRIGGER IF EXISTS trg_report_jobs_updated_at ON report_jobs;
CREATE TRIGGER trg_report_jobs_updated_at BEFORE UPDATE ON report_jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_report_recipients_updated_at ON report_recipients;
CREATE TRIGGER trg_report_recipients_updated_at BEFORE UPDATE ON report_recipients
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_report_templates_updated_at ON report_templates;
CREATE TRIGGER trg_report_templates_updated_at BEFORE UPDATE ON report_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_scheduled_reports_updated_at ON scheduled_reports;
CREATE TRIGGER trg_scheduled_reports_updated_at BEFORE UPDATE ON scheduled_reports
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_email_provider_config_updated_at ON email_provider_config;
CREATE TRIGGER trg_email_provider_config_updated_at BEFORE UPDATE ON email_provider_config
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO report_templates (code, name, audience, subject_template, html_template, system_template)
VALUES
  ('manager-summary', 'Resumo para gestores', 'manager', '[AC.Prod] {{title}} - {{period}}', '<h1>{{title}}</h1><p>{{summary}}</p>', true),
  ('lot-status', 'Situação de lote', 'lot', '[AC.Prod] Situação do lote {{lot_code}}', '<h1>Lote {{lot_code}}</h1><p>{{summary}}</p>', true),
  ('cell-performance', 'Desempenho da célula', 'cell', '[AC.Prod] Desempenho - {{cell}}', '<h1>{{cell}}</h1><p>{{summary}}</p>', true),
  ('critical-alert', 'Alerta operacional', 'alert', '[AC.Prod] Alerta: {{title}}', '<h1>{{title}}</h1><p>{{summary}}</p>', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_requests_select ON ai_requests;
CREATE POLICY ai_requests_select ON ai_requests FOR SELECT TO authenticated
USING (user_id = auth.uid() OR get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS ai_requests_insert ON ai_requests;
CREATE POLICY ai_requests_insert ON ai_requests FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND has_ai_permission());

DROP POLICY IF EXISTS report_jobs_select ON report_jobs;
CREATE POLICY report_jobs_select ON report_jobs FOR SELECT TO authenticated
USING (requested_by = auth.uid() OR get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS report_jobs_insert ON report_jobs;
CREATE POLICY report_jobs_insert ON report_jobs FOR INSERT TO authenticated
WITH CHECK (requested_by = auth.uid() AND has_ai_permission());
DROP POLICY IF EXISTS report_jobs_update ON report_jobs;
CREATE POLICY report_jobs_update ON report_jobs FOR UPDATE TO authenticated
USING (requested_by = auth.uid() OR get_my_role() IN ('admin','manager'));

DROP POLICY IF EXISTS report_recipients_manage ON report_recipients;
CREATE POLICY report_recipients_manage ON report_recipients FOR ALL TO authenticated
USING (get_my_role() IN ('admin','manager')) WITH CHECK (get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS report_templates_select ON report_templates;
CREATE POLICY report_templates_select ON report_templates FOR SELECT TO authenticated USING (has_ai_permission());
DROP POLICY IF EXISTS report_templates_manage ON report_templates;
CREATE POLICY report_templates_manage ON report_templates FOR ALL TO authenticated
USING (get_my_role() IN ('admin','manager')) WITH CHECK (get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS scheduled_reports_manage ON scheduled_reports;
CREATE POLICY scheduled_reports_manage ON scheduled_reports FOR ALL TO authenticated
USING (get_my_role() IN ('admin','manager')) WITH CHECK (get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS report_email_logs_select ON report_email_logs;
CREATE POLICY report_email_logs_select ON report_email_logs FOR SELECT TO authenticated
USING (get_my_role() IN ('admin','manager') OR sent_by = auth.uid());
DROP POLICY IF EXISTS report_email_logs_insert ON report_email_logs;
CREATE POLICY report_email_logs_insert ON report_email_logs FOR INSERT TO authenticated
WITH CHECK (has_ai_permission());
DROP POLICY IF EXISTS ai_system_logs_select ON ai_system_logs;
CREATE POLICY ai_system_logs_select ON ai_system_logs FOR SELECT TO authenticated
USING (get_my_role() IN ('admin','manager') OR user_id = auth.uid());
DROP POLICY IF EXISTS ai_system_logs_insert ON ai_system_logs;
CREATE POLICY ai_system_logs_insert ON ai_system_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS email_provider_config_admin ON email_provider_config;
CREATE POLICY email_provider_config_admin ON email_provider_config FOR ALL TO authenticated
USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

UPDATE profiles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"ai_operations": true}'::jsonb
WHERE role IN ('admin','manager')
  AND NOT (COALESCE(permissions, '{}'::jsonb) ? 'ai_operations');

-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 003: Logs de Auditoria + Relatórios Automáticos
-- ============================================================

-- ─── Logs de Auditoria do Sistema ────────────────────────────
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name       text,
  user_email      text,
  user_role       text,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  entity_label    text,
  page            text,
  route           text,
  method          text,
  old_value       jsonb,
  new_value       jsonb,
  metadata        jsonb DEFAULT '{}',
  ip_address      text,
  user_agent      text,
  device_id       text,
  session_id      text,
  success         boolean DEFAULT true,
  error_message   text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON system_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON system_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON system_audit_logs(entity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON system_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success    ON system_audit_logs(success);

-- ─── Agendamentos de Relatórios ───────────────────────────────
CREATE TABLE IF NOT EXISTS report_schedules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  enabled                boolean DEFAULT true,
  report_type            text NOT NULL
                         CHECK (report_type IN (
                           'daily_production','shift_closure','oee',
                           'traceability_pending','lots_delayed','packaging_pending',
                           'shipping_pending','executive_summary'
                         )),
  time_local             time NOT NULL DEFAULT '07:00:00',
  timezone               text DEFAULT 'America/Sao_Paulo',
  frequency              text NOT NULL DEFAULT 'daily'
                         CHECK (frequency IN ('daily','workdays','weekly','monthly')),
  cell_filter            text[] DEFAULT '{}',
  stage_filter           text[] DEFAULT '{}',
  recipient_profile_ids  uuid[] DEFAULT '{}',
  extra_emails           text[] DEFAULT '{}',
  format                 text DEFAULT 'email_html'
                         CHECK (format IN ('pdf','xlsx','csv','email_html')),
  last_sent_at           timestamptz,
  next_run_at            timestamptz,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE TRIGGER trg_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Log de Entrega de Relatórios ────────────────────────────
CREATE TABLE IF NOT EXISTS report_delivery_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_schedule_id  uuid REFERENCES report_schedules(id) ON DELETE SET NULL,
  recipient_email     text NOT NULL,
  status              text NOT NULL DEFAULT 'sent'
                      CHECK (status IN ('sent','failed','skipped')),
  error_message       text,
  sent_at             timestamptz DEFAULT now(),
  file_path           text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_schedule_id ON report_delivery_logs(report_schedule_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_status      ON report_delivery_logs(status);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_sent_at     ON report_delivery_logs(sent_at DESC);

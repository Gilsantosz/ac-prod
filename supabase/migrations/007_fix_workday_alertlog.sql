-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 007: Correções Técnicas (WorkdayCalendar + AlertLog)
-- ============================================================

-- ─── Criar tabela real workday_calendar ──────────────────────
-- (Antes era um fallback para production_entries em localDb.js)
CREATE TABLE IF NOT EXISTS workday_calendar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  is_workday  boolean NOT NULL DEFAULT true,
  shift       text,
  cell        text,
  reason      text,  -- ex: 'Feriado Nacional', 'Parada Programada'
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (date, cell, shift)
);

CREATE INDEX IF NOT EXISTS idx_workday_calendar_date ON workday_calendar(date);
CREATE INDEX IF NOT EXISTS idx_workday_calendar_cell ON workday_calendar(cell);

ALTER TABLE workday_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workday_select_all" ON workday_calendar
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "workday_write_admin_manager" ON workday_calendar
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE TRIGGER trg_workday_calendar_updated_at
  BEFORE UPDATE ON workday_calendar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Padronizar alert_logs ────────────────────────────────────
-- Adicionar colunas faltantes se a tabela já existe
ALTER TABLE alert_logs
  ADD COLUMN IF NOT EXISTS rule_id        uuid,
  ADD COLUMN IF NOT EXISTS message        text,
  ADD COLUMN IF NOT EXISTS cell           text,
  ADD COLUMN IF NOT EXISTS severity       text DEFAULT 'warning',
  ADD COLUMN IF NOT EXISTS resolved       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by    uuid,
  ADD COLUMN IF NOT EXISTS resolved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS triggered_at   timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS metadata       jsonb DEFAULT '{}';

-- Índices para alert_logs
CREATE INDEX IF NOT EXISTS idx_alert_logs_resolved    ON alert_logs(resolved);
CREATE INDEX IF NOT EXISTS idx_alert_logs_cell        ON alert_logs(cell);
CREATE INDEX IF NOT EXISTS idx_alert_logs_triggered   ON alert_logs(triggered_at DESC);

-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 002: Campos opcionais em tabelas EXISTENTES
-- Todos os campos são NULLABLE — zero impacto nos dados atuais.
-- ============================================================

-- ─── production_entries: vincular ao lote/etapa ───────────────
ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS order_id       uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_id         uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_item_id    uuid REFERENCES lot_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_code      text,
  ADD COLUMN IF NOT EXISTS route_step_id  uuid,
  ADD COLUMN IF NOT EXISTS work_center_id uuid;

-- ─── occurrences: vincular ao lote/etapa ─────────────────────
ALTER TABLE occurrences
  ADD COLUMN IF NOT EXISTS order_id              uuid,
  ADD COLUMN IF NOT EXISTS lot_id                uuid,
  ADD COLUMN IF NOT EXISTS lot_item_id           uuid,
  ADD COLUMN IF NOT EXISTS step_code             text,
  ADD COLUMN IF NOT EXISTS reason_category       text,
  ADD COLUMN IF NOT EXISTS affects_traceability  boolean DEFAULT false;

-- ─── profiles: campos de gestor (já usa profiles com role=manager) ──
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active                    boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_alerts           boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_daily_report     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_trace_report     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_shipping_report  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_send_time          time,
  ADD COLUMN IF NOT EXISTS report_frequency          text DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS extra_emails              text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS managed_cells             text[] DEFAULT '{}';

-- Índices extras
CREATE INDEX IF NOT EXISTS idx_production_entries_lot_id  ON production_entries(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_production_entries_order_id ON production_entries(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_occurrences_lot_id         ON occurrences(lot_id) WHERE lot_id IS NOT NULL;

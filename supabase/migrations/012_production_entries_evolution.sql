-- ============================================================
-- AC.Prod - Evolução da Entrada de Produção
-- Adição de campos para rastreabilidade manual, correção/estorno e auditoria.
-- ============================================================

ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS product_code text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS process_step text,
  ADD COLUMN IF NOT EXISTS station_name text,
  ADD COLUMN IF NOT EXISTS entry_mode text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual_entry',
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES occurrences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'valid'
                      CHECK (approval_status IN ('valid', 'corrected', 'cancelled', 'reversed', 'pending_review')),
  ADD COLUMN IF NOT EXISTS correction_of uuid REFERENCES production_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS corrected_by text,
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

-- Índices recomendados para otimização de consultas e relatórios
CREATE INDEX IF NOT EXISTS idx_entries_lot_code ON production_entries(lot_code) WHERE lot_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_order_number ON production_entries(order_number) WHERE order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_product_code ON production_entries(product_code) WHERE product_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_process_step ON production_entries(process_step) WHERE process_step IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_approval_status ON production_entries(approval_status);
CREATE INDEX IF NOT EXISTS idx_entries_hour ON production_entries(hour);

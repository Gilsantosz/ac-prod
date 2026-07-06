-- ============================================================
-- AC.Prod MES — Fase 2: Unificação de Campos Duplicados
-- Migration 025 — Aditiva, sem DROP de dados existentes
-- Canoniza production_order_id e current_step em production_lots
-- ============================================================

-- 1. Garantir que production_order_id seja o FK canônico
UPDATE production_lots
SET production_order_id = order_id
WHERE production_order_id IS NULL AND order_id IS NOT NULL;

UPDATE production_lots
SET order_id = production_order_id
WHERE order_id IS NULL AND production_order_id IS NOT NULL;

-- 2. Garantir que current_step seja o campo canônico
UPDATE production_lots
SET current_step = current_stage
WHERE (current_step IS NULL OR current_step = '')
  AND current_stage IS NOT NULL AND current_stage <> '';

UPDATE production_lots
SET current_stage = current_step
WHERE (current_stage IS NULL OR current_stage = '')
  AND current_step IS NOT NULL AND current_step <> '';

-- 3. Atualizar trigger de sincronização
CREATE OR REPLACE FUNCTION sync_production_lot_context()
RETURNS trigger AS $$
BEGIN
  -- production_order_id é o FK canônico; order_id é alias de compatibilidade
  NEW.production_order_id := COALESCE(NEW.production_order_id, NEW.order_id);
  NEW.order_id := COALESCE(NEW.order_id, NEW.production_order_id);

  -- current_step é o campo canônico; current_stage é alias de compatibilidade
  NEW.current_step  := COALESCE(NULLIF(NEW.current_step, ''),  NULLIF(NEW.current_stage, ''), 'imported');
  NEW.current_stage := COALESCE(NULLIF(NEW.current_stage, ''), NEW.current_step);

  -- Pending quantity sempre derivado (não pode ser negativo)
  NEW.pending_quantity := GREATEST(
    COALESCE(NEW.planned_quantity, 0) - COALESCE(NEW.produced_quantity, 0),
    0
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_production_lot_context ON production_lots;
CREATE TRIGGER trg_sync_production_lot_context
  BEFORE INSERT OR UPDATE ON production_lots
  FOR EACH ROW EXECUTE FUNCTION sync_production_lot_context();

-- 4. Documentar campos canônicos via COMMENT
COMMENT ON COLUMN production_lots.production_order_id IS
  '[CANÔNICO] FK para production_orders. Use sempre este campo. order_id é alias de compatibilidade (Fase 2 / 2025-07).';

COMMENT ON COLUMN production_lots.order_id IS
  '[ALIAS] Campo legado. Mantido em sincronismo com production_order_id via trigger. Não usar em código novo.';

COMMENT ON COLUMN production_lots.current_step IS
  '[CANÔNICO] Etapa atual do lote na rota produtiva. Use sempre este campo. current_stage é alias de compatibilidade (Fase 2 / 2025-07).';

COMMENT ON COLUMN production_lots.current_stage IS
  '[ALIAS] Campo legado. Mantido em sincronismo com current_step via trigger. Não usar em código novo.';

-- 5. Índices de performance nos campos canônicos
CREATE INDEX IF NOT EXISTS idx_production_lots_production_order_id ON production_lots(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_lots_current_step ON production_lots(current_step);
CREATE INDEX IF NOT EXISTS idx_production_lots_status ON production_lots(status);
CREATE INDEX IF NOT EXISTS idx_production_lots_lot_code ON production_lots(lot_code);

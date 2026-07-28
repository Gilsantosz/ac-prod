BEGIN;

-- MIGRATION 20260728100000: Fix replacement approval duplicate key constraint on production_stage_readings
-- Substitui o índice único legado uq_approved_item_step (baseado em item_id) pelo índice canônico uq_approved_piece_step (baseado em piece_id).
-- Isso permite a aprovação e liberação de peças de reposição (e múltiplas peças por lote) sem colisão de chave primária/única.

DROP INDEX IF EXISTS public.uq_approved_item_step;

CREATE UNIQUE INDEX IF NOT EXISTS uq_approved_piece_step
  ON public.production_stage_readings(piece_id, step_name)
  WHERE status = 'approved' AND piece_id IS NOT NULL;

COMMIT;

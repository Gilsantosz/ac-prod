-- Transitional compatibility for cached/older AC.Prod2 front-end builds.
-- The canonical source remains tag_value/piece_code; these generated columns
-- can be removed in a later release after every client is on the corrected UI.

ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS raw_value text
  GENERATED ALWAYS AS (tag_value) STORED;

ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS traceability_code text
  GENERATED ALWAYS AS (coalesce(piece_code, tag_value)) STORED;

CREATE INDEX IF NOT EXISTS idx_stage_readings_raw_value_compat
  ON public.production_stage_readings (raw_value)
  WHERE raw_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stage_readings_traceability_code_compat
  ON public.production_stage_readings (traceability_code)
  WHERE traceability_code IS NOT NULL;

-- Restaura os relacionamentos usados pelas consultas incorporadas do PostgREST
-- na versão de frontend que já está em produção.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.quality_nonconformities'::regclass
      AND conname = 'quality_nonconformities_defect_id_fkey'
  ) THEN
    ALTER TABLE public.quality_nonconformities
      ADD CONSTRAINT quality_nonconformities_defect_id_fkey
      FOREIGN KEY (defect_id)
      REFERENCES public.quality_defect_catalog(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.quality_nonconformities'::regclass
      AND conname = 'quality_nonconformities_piece_id_fkey'
  ) THEN
    ALTER TABLE public.quality_nonconformities
      ADD CONSTRAINT quality_nonconformities_piece_id_fkey
      FOREIGN KEY (piece_id)
      REFERENCES public.production_pieces(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_quality_nonconformities_defect_id
  ON public.quality_nonconformities(defect_id);
CREATE INDEX IF NOT EXISTS idx_quality_nonconformities_piece_id
  ON public.quality_nonconformities(piece_id);

NOTIFY pgrst, 'reload schema';

COMMIT;

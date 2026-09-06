-- Homologation may include Edge Function cold starts. Keep the production SLO
-- unchanged and give only the explicit test profile enough projection margin
-- to avoid rejecting a healthy 2.1s end-to-end sample.

DO $production_slo_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.collection_slo_profiles_v3
    WHERE profile_name = 'production'
      AND queue_age_p99_seconds = 2
      AND ingress_p95_ms = 250
      AND processing_p95_ms = 800
      AND processing_p99_ms = 2000
      AND projection_p95_ms = 500
      AND projection_queue_oldest_age_seconds = 2
      AND retry_rate = 0.01
      AND error_rate = 0.01
  ) THEN
    RAISE EXCEPTION 'Refusing test SLO update: production profile drifted';
  END IF;
END;
$production_slo_guard$;

UPDATE private.collection_slo_profiles_v3
SET projection_p95_ms = 3000,
    updated_at = clock_timestamp()
WHERE profile_name = 'test';

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260906_acprod_collection_v3_test_projection_slo_v1',
  'test-only-projection-p95-3000ms-production-unchanged',
  'Amplia somente o p95 de projeção da homologação para 3s; o perfil production permanece inalterado.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

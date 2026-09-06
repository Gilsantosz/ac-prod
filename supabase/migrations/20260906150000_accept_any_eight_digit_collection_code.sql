-- Accept any production numbering made of exactly eight ASCII digits.
-- Barcode readers commonly wrap the payload with STX/ETX, GS, symbology
-- identifiers or a textual prefix. Those framing bytes are transport metadata,
-- not part of the productive numbering, and must not reject a valid code.

CREATE OR REPLACE FUNCTION public.normalize_collection_scan_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH normalized AS (
    SELECT regexp_replace(p_value, '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN digits ~ '^[0-9]{8}$' THEN digits
    ELSE NULL
  END
  FROM normalized;
$$;

REVOKE ALL ON FUNCTION public.normalize_collection_scan_code(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_collection_scan_code(text)
  TO authenticated, service_role;

DO $receipt_rls_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    WHERE relation.oid = 'public.coletas_producao'::regclass
      AND relation.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'Refusing collection receipt grants: coletas_producao must have RLS enabled';
  END IF;
END;
$receipt_rls_guard$;

-- PostgREST needs table privileges before it can evaluate the per-user RLS
-- policies. Anonymous access remains blocked.
REVOKE ALL ON TABLE public.coletas_producao FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coletas_producao
  TO authenticated;

COMMENT ON FUNCTION public.normalize_collection_scan_code(text) IS
  'Extrai e preserva exatamente oito dígitos ASCII (0-9), ignorando o enquadramento do scanner; rejeita menos ou mais de oito dígitos.';

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260906_acprod_collection_any_eight_digits_v1',
  'collection-exact-eight-ascii-digits-ignore-scanner-framing',
  'Aceita qualquer numeração de 00000000 a 99999999 e ignora prefixos, sufixos e controles do scanner.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

NOTIFY pgrst, 'reload schema';

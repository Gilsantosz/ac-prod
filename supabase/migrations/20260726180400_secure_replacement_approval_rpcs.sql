-- Restringe os RPCs transacionais de reposição aos usuários internos autenticados
-- e aplica autorização no banco, sem depender apenas das permissões da interface.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.normalize_replacement_step_code(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replacement_cell_matches_step(text, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_replacement_order_context(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_replacement_approval_cells(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_piece_replacement(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_replacement_order_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_replacement_approval_cells(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_piece_replacement(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_replacement_approval_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_allowed boolean := false;
BEGIN
  -- Chamadas administrativas diretas, migrações e service role não possuem
  -- auth.uid(). A validação abaixo protege as chamadas efetuadas pelo cliente.
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('requested', 'under_review')
     AND NEW.status IN ('approved', 'released', 'in_production', 'completed') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = v_user_id
        AND COALESCE(p.active, true) IS TRUE
        AND (
          lower(COALESCE(p.role, '')) IN ('admin', 'manager')
          OR lower(COALESCE(p.permissions->>'approve_replacements', 'false')) = 'true'
        )
    )
    INTO v_allowed;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Usuário sem permissão para aprovar reposições.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_replacement_approval_permission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_replacement_approval_permission
  ON public.replacement_orders;

CREATE TRIGGER trg_enforce_replacement_approval_permission
BEFORE UPDATE OF status ON public.replacement_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_replacement_approval_permission();

COMMIT;

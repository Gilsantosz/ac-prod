-- Correct the missing piece_code value in the station's canonical INSERT.
-- Preserve the deployed function, authorization checks, locks and grants.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$    v_expected_code,
    case when v_is_last then 'approved_via_replacement' else 'replacement_stage' end,$old$;
  v_new text := $new$    v_expected_code,
    coalesce(nullif(v_replacement_piece.piece_code, ''), v_replacement_piece.traceability_code, v_replacement_piece.piece_uid),
    case when v_is_last then 'approved_via_replacement' else 'replacement_stage' end,$new$;
BEGIN
  SELECT pg_get_functiondef('public.collect_replacement_stage_v2(text,text,uuid,text,timestamptz,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_new IN v_definition) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_definition) = 0
     OR (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Unexpected replacement station INSERT definition; review before applying';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;
NOTIFY pgrst, 'reload schema';

-- A station collection changes progress; it does not grant managerial approval.
-- INVOKER lets this guard distinguish the already-authorized SECURITY DEFINER
-- collector from direct authenticated table updates. Require its canonical fact
-- and piece state too; never trust a client payload or a user-settable GUC flag.
CREATE OR REPLACE FUNCTION public.enforce_replacement_approval_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $function$
BEGIN
  IF auth.role() = 'service_role' OR public.can_manage_replacement_actions() THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL
     AND current_user = (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.collect_replacement_stage_v2(text,text,uuid,text,timestamptz,jsonb)'::regprocedure)
     AND OLD.status IN ('released', 'in_production')
     AND NEW.status IN ('in_production', 'completed')
     AND (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'completed_at']) = (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'completed_at'])
     AND EXISTS (
       SELECT 1 FROM public.production_pieces piece
       JOIN public.production_stage_readings reading ON reading.piece_id = piece.id
       WHERE piece.id = NEW.replacement_piece_id
         AND piece.original_piece_id = NEW.original_piece_id
         AND piece.is_replacement IS TRUE
         AND ((NEW.status = 'in_production' AND piece.status IN ('in_progress', 'in_production')) OR (NEW.status = 'completed' AND piece.status = 'completed'))
         AND reading.user_id = auth.uid()
         AND reading.status = 'approved'
         AND reading.event_type = 'replacement_approval'
         AND reading.step_name = ANY(piece.completed_steps)
         AND reading.created_at >= transaction_timestamp()
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'REPLACEMENT_APPROVAL_PERMISSION_REQUIRED' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_replacement_approval_permission() FROM PUBLIC, anon, authenticated;

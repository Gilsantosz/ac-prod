-- AC.Prod Collection Fabric v3 — compatibilidade do projetor com o contrato
-- efetivamente instalado de switch_cell_active_lot_context (sete argumentos).

SET check_function_bodies = on;

DO $projection_runtime_compatibility$
DECLARE
  v_projector regprocedure := to_regprocedure(
    'private.process_collection_projection_batch_v3(text,jsonb)'
  );
  v_definition text;
  v_rewritten text;
  v_old_signature constant text :=
    'public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid)';
  v_new_signature constant text :=
    'public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid,timestamptz,text)';
  v_old_call constant text :=
    'SELECT public.switch_cell_active_lot_context($1, $2, $3, $4, $5)';
  v_new_call constant text :=
    'SELECT public.switch_cell_active_lot_context($1, $2, $3, $4, $5, $6, $7)';
  v_old_arguments constant text :=
    'v_item.lot_id, v_item.pcp_import_batch_id;';
  v_new_arguments constant text := E'v_item.lot_id, v_item.pcp_import_batch_id,\n                v_item.outbox_created_at, v_item.client_event_id;';
  v_signature_occurrences integer;
  v_call_occurrences integer;
  v_argument_occurrences integer;
BEGIN
  IF to_regprocedure(v_new_signature) IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_V3_SWITCH_CONTEXT_SEVEN_ARGUMENT_OVERLOAD_MISSING'
      USING ERRCODE = '42883';
  END IF;

  IF v_projector IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_V3_PROJECTOR_RUNTIME_MISSING'
      USING ERRCODE = '42883';
  END IF;

  SELECT pg_get_functiondef(v_projector)
  INTO v_definition;

  v_signature_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_signature, ''))
  ) / length(v_old_signature);
  v_call_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_call, ''))
  ) / length(v_old_call);
  v_argument_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_arguments, ''))
  ) / length(v_old_arguments);

  IF position(v_new_signature IN v_definition) = 0
     OR position(v_new_call IN v_definition) = 0
     OR position(v_new_arguments IN v_definition) = 0 THEN
    IF v_signature_occurrences <> 1
       OR v_call_occurrences <> 1
       OR v_argument_occurrences <> 1 THEN
      RAISE EXCEPTION
        'COLLECTION_V3_PROJECTOR_RUNTIME_UNEXPECTED_DEFINITION signature=% call=% arguments=%',
        v_signature_occurrences,
        v_call_occurrences,
        v_argument_occurrences
        USING ERRCODE = '55000';
    END IF;

    v_rewritten := replace(v_definition, v_old_signature, v_new_signature);
    v_rewritten := replace(v_rewritten, v_old_call, v_new_call);
    v_rewritten := replace(v_rewritten, v_old_arguments, v_new_arguments);

    EXECUTE v_rewritten;
  END IF;

  SELECT pg_get_functiondef(
    'private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure
  )
  INTO v_definition;

  IF position(v_new_signature IN v_definition) = 0
     OR position(v_new_call IN v_definition) = 0
     OR position(v_new_arguments IN v_definition) = 0
     OR position(v_old_signature IN v_definition) > 0
     OR position(v_old_call IN v_definition) > 0 THEN
    RAISE EXCEPTION 'COLLECTION_V3_PROJECTOR_RUNTIME_COMPATIBILITY_PATCH_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$projection_runtime_compatibility$;

REVOKE ALL ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  TO service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_projector_runtime_compatibility',
  'collection-v3-projector-switch-context-seven-arguments-event-identity',
  'Alinha o projetor ao overload real de sete argumentos, preservando outbox_created_at e client_event_id na troca do contexto ativo.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

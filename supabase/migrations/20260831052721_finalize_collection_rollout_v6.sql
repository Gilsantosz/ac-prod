-- AC.Prod2 — final deployment contract for collection lifecycle v6.
-- This migration is idempotent and fail-closed: it records a public, non-sensitive
-- release marker only after the required schema/runtime integrity checks pass.

DO $contract$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_duplicate_groups bigint := 0;
  v_complete_but_open bigint := 0;
  v_closed_but_incomplete bigint := 0;
BEGIN
  IF to_regclass('public.production_cell_lot_states') IS NULL THEN v_missing := array_append(v_missing, 'production_cell_lot_states'); END IF;
  IF to_regclass('public.production_cell_active_contexts') IS NULL THEN v_missing := array_append(v_missing, 'production_cell_active_contexts'); END IF;
  IF to_regprocedure('public.process_production_reading_v2(jsonb)') IS NULL THEN v_missing := array_append(v_missing, 'process_production_reading_v2(jsonb)'); END IF;
  IF to_regprocedure('public.resolve_operator_shift_window(uuid,timestamptz)') IS NULL THEN v_missing := array_append(v_missing, 'resolve_operator_shift_window(uuid,timestamptz)'); END IF;
  IF to_regprocedure('public.get_operator_shift_kpis_v2(uuid,timestamptz)') IS NULL THEN v_missing := array_append(v_missing, 'get_operator_shift_kpis_v2(uuid,timestamptz)'); END IF;
  IF to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NULL THEN v_missing := array_append(v_missing, 'recalculate_cell_lot_state(uuid,text,text,uuid,uuid)'); END IF;
  IF to_regprocedure('public.refresh_collection_lot_state(uuid,uuid)') IS NULL THEN v_missing := array_append(v_missing, 'refresh_collection_lot_state(uuid,uuid)'); END IF;
  IF cardinality(v_missing) > 0 THEN RAISE EXCEPTION 'ACPROD_COLLECTION_V6_INCOMPLETE: %', array_to_string(v_missing, ', '); END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_start_time')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_end_time')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='timezone') THEN
    RAISE EXCEPTION 'ACPROD_COLLECTION_V6_INCOMPLETE: operator shift columns missing';
  END IF;

  IF NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='public.production_cell_lot_states'::regclass),false)
     OR NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='public.production_cell_active_contexts'::regclass),false) THEN
    RAISE EXCEPTION 'ACPROD_COLLECTION_V6_INCOMPLETE: lifecycle RLS disabled';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='production_cell_lot_states')
     OR NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='production_cell_active_contexts') THEN
    RAISE EXCEPTION 'ACPROD_COLLECTION_V6_INCOMPLETE: lifecycle Realtime disabled';
  END IF;

  SELECT count(*) INTO v_duplicate_groups FROM (
    SELECT reading.piece_id, public.normalize_route_step_code(reading.step_name), coalesce(reading.production_cycle,1)
    FROM public.production_stage_readings reading
    WHERE reading.status='approved' AND reading.piece_id IS NOT NULL AND nullif(btrim(reading.step_name),'') IS NOT NULL
    GROUP BY reading.piece_id, public.normalize_route_step_code(reading.step_name), coalesce(reading.production_cycle,1)
    HAVING count(*)>1
  ) duplicated;
  IF v_duplicate_groups > 0 THEN RAISE EXCEPTION 'ACPROD_COLLECTION_V6_DUPLICATES: %', v_duplicate_groups; END IF;

  SELECT count(*) FILTER (WHERE coalesce((metrics->>'is_complete')::boolean,false) AND lot.status<>'closed'),
         count(*) FILTER (WHERE NOT coalesce((metrics->>'is_complete')::boolean,false) AND lot.status='closed')
  INTO v_complete_but_open,v_closed_but_incomplete
  FROM public.production_lots lot
  CROSS JOIN LATERAL public.get_collection_lot_route_metrics(lot.id) metrics
  WHERE lot.status NOT IN ('cancelled','shipped');
  IF v_complete_but_open>0 OR v_closed_but_incomplete>0 THEN
    RAISE EXCEPTION 'ACPROD_COLLECTION_V6_LOT_DRIFT: complete_open=%, closed_incomplete=%',v_complete_but_open,v_closed_but_incomplete;
  END IF;
END
$contract$;

ALTER TABLE public.production_stage_readings ADD COLUMN IF NOT EXISTS raw_value text GENERATED ALWAYS AS (tag_value) STORED;
ALTER TABLE public.production_stage_readings ADD COLUMN IF NOT EXISTS traceability_code text GENERATED ALWAYS AS (coalesce(piece_code,tag_value)) STORED;
CREATE INDEX IF NOT EXISTS idx_stage_readings_raw_value_compat ON public.production_stage_readings(raw_value) WHERE raw_value IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stage_readings_traceability_code_compat ON public.production_stage_readings(traceability_code) WHERE traceability_code IS NOT NULL;

INSERT INTO public.app_schema_releases(version,checksum,notes)
VALUES ('20260831_acprod_collection_db_v6','collection-v6-lock-route-lifecycle-shifts-realtime-history','Concorrência por peça, sequência de rota, lote por célula, fechamento global, turnos, Realtime e compatibilidade do histórico validados.')
ON CONFLICT(version) DO UPDATE SET checksum=excluded.checksum,notes=excluded.notes;

CREATE OR REPLACE FUNCTION public.get_public_collection_release() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
SELECT jsonb_build_object('ready',true,'migration_version','20260831053000','release_version','20260831_acprod_collection_db_v6','schema_flags',jsonb_build_object('shift_columns',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_start_time') AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_end_time'),'cell_lifecycle',to_regclass('public.production_cell_lot_states') IS NOT NULL,'active_context',to_regclass('public.production_cell_active_contexts') IS NOT NULL,'reading_v2',to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public.get_public_collection_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_release() TO anon,authenticated;

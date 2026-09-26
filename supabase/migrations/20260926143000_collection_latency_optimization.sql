-- Reduce collection contention and repeated authorized dashboard work.
-- Preserve authorization and idempotency; pin the reviewed ingress/audit revisions explicitly.
-- Tested parts are applied atomically. Abort promptly instead of waiting on production locks.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
-- Fail closed if any production definition changed after the reviewed export.
DO $baseline$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
('private','audit_collection_immediate_release_v1','','d5be4470cb4a9623487c95611914cb07'),
('private','get_lot_route_stage_progress_uncached_capacity','p_batch_id uuid','426ca4134aedb1219a5216c48ed66905'),
('private','process_collection_batch_v3','p_worker_id text, p_items jsonb','0aeb456f60de5e681884d2901ecd515c'),
('private','process_collection_projection_batch_v3','p_worker_id text, p_items jsonb','83396bc4368b95416931be950e1af1ee'),
('public','get_collection_dashboard_snapshot_v3','p_cell_name text, p_workstation_id uuid, p_operator_id uuid, p_pcp_import_batch_id uuid, p_lot_id uuid, p_reference_time timestamp with time zone','4e04cc8e0c3eb2e267f40c737795c8ba'),
('public','get_collection_dashboard_snapshot_v3','p_cell_name text, p_workstation_id uuid, p_operator_session_token text, p_pcp_import_batch_id uuid, p_lot_id uuid, p_reference_time timestamp with time zone','b386004cd44b40858a7785da53af76ab'),
('public','get_collection_history_count_impl','p_cell_id uuid, p_workstation_id uuid, p_operator_id uuid, p_shift text, p_status text, p_lot_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_cell_name text','e14cbca66163a75130e508519d4dd329'),
('public','get_collection_history_impl','p_cell_id uuid, p_workstation_id uuid, p_operator_id uuid, p_shift text, p_status text, p_lot_id uuid, p_limit integer, p_offset integer, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_cell_name text','ddc2429902c35812fd365f535d4e881f'),
('public','get_collection_lot_route_metrics','p_lot_id uuid','74c91aed809b961933020a8356a47711'),
('public','get_collection_route_stage_metrics','p_pcp_import_batch_id uuid, p_lot_id uuid, p_step_code text','40db885d125cd98bf503a5eea9d8b2a8'),
('public','get_general_lot_tracking_base','p_batch_id uuid, p_limit integer','8bcda36036966fcb68c6387d40173550'),
('public','get_lot_route_stage_progress','p_batch_id uuid','de535feba777f7ff4f15e411ea2a1e80'),
('public','ingest_collection_batch_immediate_v3','p_batch_id uuid, p_device_id uuid, p_events jsonb','90ffa0ee5c0f4b6b82c3a92a7d056bcf'),
('public','process_collection_batch_v3','p_worker_id text, p_items jsonb','233e6cf9e90ca86cdc9cf83bba53af96'),
('public','process_collection_projection_batch_v3','p_worker_id text, p_items jsonb','26a039f684335b97cac07bdff8bd0921'),
('public','reconcile_replacement_piece_trail','p_piece_id uuid','177368d81ae1f084920ca79a5cf3f6fe'),
('public','refresh_collection_lot_state','p_lot_id uuid, p_reading_id uuid','b13bda58f4ca1fd5ea908e13963e48af'),
('public','refresh_pcp_batch_progress','p_batch_id uuid','639264a21de48ab9cc70d066d7cdf45b'),
('public','sync_replacement_trail_from_reading','','555d430fd51f144d9ec01d8ace0db90e')
 ) signatures(schema_name,function_name,arguments,definition_hash)
 LOOP
   SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname=expected.schema_name AND p.proname=expected.function_name
     AND pg_get_function_identity_arguments(p.oid)=expected.arguments;
   IF actual IS DISTINCT FROM expected.definition_hash THEN
     RAISE EXCEPTION 'LATENCY_RELEASE_BASELINE_MISMATCH: %.%(%)',expected.schema_name,expected.function_name,expected.arguments;
   END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_lots' AND policyname='production_lots_scoped_read' AND qual='can_access_production_lot(id)' AND with_check IS NULL AND roles=ARRAY['authenticated'::name] AND cmd='SELECT') THEN RAISE EXCEPTION 'LATENCY_RELEASE_POLICY_MISMATCH: production_lots_scoped_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_orders' AND policyname='production_orders_scoped_read' AND qual='can_access_production_order(id)' AND with_check IS NULL AND roles=ARRAY['authenticated'::name] AND cmd='SELECT') THEN RAISE EXCEPTION 'LATENCY_RELEASE_POLICY_MISMATCH: production_orders_scoped_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_pieces' AND policyname='production_pieces_scoped_read' AND qual='can_access_production_piece(id)' AND with_check IS NULL AND roles=ARRAY['authenticated'::name] AND cmd='SELECT') THEN RAISE EXCEPTION 'LATENCY_RELEASE_POLICY_MISMATCH: production_pieces_scoped_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_stage_readings' AND policyname='production_stage_readings_scoped_read' AND qual='(current_profile_has_global_cell_access() OR profile_can_access_cell(cell_name) OR ((NULLIF(btrim(cell_name), ''''::text) IS NULL) AND (piece_id IS NOT NULL) AND can_access_production_piece(piece_id)) OR ((NULLIF(btrim(cell_name), ''''::text) IS NULL) AND (piece_id IS NULL) AND can_access_production_lot(lot_id)))' AND with_check IS NULL AND roles=ARRAY['authenticated'::name] AND cmd='SELECT') THEN RAISE EXCEPTION 'LATENCY_RELEASE_POLICY_MISMATCH: production_stage_readings_scoped_read'; END IF;
END; $baseline$;
-- Source: 20260920153320_collection_projector_lock_order.sql
-- Projector A holds the lot advisory lock; projector B holds an FK KEY SHARE
-- and waits for that advisory lock. A's FOR UPDATE then waits for B: deadlock.
-- Lot snapshots change no key. NO KEY UPDATE permits the FK check while still
-- excluding concurrent lot updates/deletion and preserving the advisory guard.

DO $patch$
DECLARE
  definition text;
  needle text := E'  FROM public.production_lots\n  WHERE id = p_lot_id\n  FOR UPDATE;';
BEGIN
  definition := pg_get_functiondef('public.refresh_collection_lot_state(uuid,uuid)'::regprocedure);
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'LOT_ROW_LOCK_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,replace(needle,'FOR UPDATE;','FOR NO KEY UPDATE;'));
END;
$patch$;

-- Source: 20260920154917_collection_immediate_error_details.sql
-- Preserve the existing failure/rollback contract; expose only fixed reason
-- codes so lock/timeout failures can be diagnosed without SQL or credentials.

DO $patch$
DECLARE
  definition text:=pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure);
  needle text:='RAISE EXCEPTION ''COLLECTION_IMMEDIATE_DECISION_NOT_COMMITTED'' USING ERRCODE=''40001'';';
  replacement text:=$new$RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_NOT_COMMITTED' USING ERRCODE='40001',
    DETAIL=(SELECT jsonb_build_object('decision_error_codes',jsonb_agg(
      CASE WHEN coalesce(x.value->>'reason_code','') ~ '^[A-Z0-9_]{1,64}$'
        THEN x.value->>'reason_code' ELSE 'UNCLASSIFIED' END))::text
      FROM jsonb_array_elements(processed) x(value)
      WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review'));$new$;
BEGIN
  IF md5(definition)<>'99a466c7964bef2a52dfe3090c760f72' THEN
    IF md5(definition)<>'90ffa0ee5c0f4b6b82c3a92a7d056bcf' OR position(needle IN definition)=0 THEN
      RAISE EXCEPTION 'IMMEDIATE_DIAGNOSTIC_SOURCE_MISMATCH';
    END IF;
    EXECUTE replace(definition,needle,replacement);
  END IF;
  IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))
    <>'99a466c7964bef2a52dfe3090c760f72' THEN RAISE EXCEPTION 'IMMEDIATE_DIAGNOSTIC_HASH_MISMATCH'; END IF;
END;
$patch$;
DO $approve$
DECLARE definition text:=pg_get_functiondef('private.audit_collection_immediate_release_v1()'::regprocedure);
BEGIN
  IF md5(definition)<>'d5be4470cb4a9623487c95611914cb07' THEN
    RAISE EXCEPTION 'IMMEDIATE_AUDIT_SOURCE_MISMATCH';
  END IF;
  EXECUTE replace(definition,'90ffa0ee5c0f4b6b82c3a92a7d056bcf','99a466c7964bef2a52dfe3090c760f72');
  -- Pin precisely the reviewed audit revision; no dynamic allow-all guard.
  UPDATE private.collection_immediate_release_snapshot_v1
  SET expected_audit_function_hash=md5(pg_get_functiondef('private.audit_collection_immediate_release_v1()'::regprocedure))
  WHERE singleton AND expected_audit_function_hash='d5be4470cb4a9623487c95611914cb07';
END;
$approve$;

-- Source: 20260920160503_collection_piece_lock_and_route_cost.sql
-- A projection inserts foreign keys to a piece and keeps KEY SHARE until commit.
-- The decision changes route/state only; NO KEY UPDATE serializes writers without
-- waiting for those FK readers. The per-piece advisory lock and unique approved
-- stage constraint remain in force.

DO $migration$
DECLARE
  definition text;
  needle text;
  replacement text;
BEGIN
  definition := pg_get_functiondef('private.process_collection_batch_v3(text,jsonb)'::regprocedure);
  needle := E'FROM public.production_pieces piece\n        WHERE piece.id = v_item.piece_id\n        FOR UPDATE;';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'DECISION_PIECE_LOCK_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,replace(needle,'FOR UPDATE;','FOR NO KEY UPDATE;'));

  -- STABLE metrics used in six JSON properties were inlined and evaluated six
  -- times per stage. Materialize once per stage, keeping the canonical result.
  definition := pg_get_functiondef('public.get_collection_lot_route_metrics(uuid)'::regprocedure);
  needle := 'stage_scope AS (';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'LOT_ROUTE_COST_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,'stage_scope AS MATERIALIZED (');

  -- Restrict approved readings by the indexed piece_id before invoking the
  -- table-backed stage-name normalizer. OFFSET 0 prevents predicate pushdown
  -- from normalizing every reading in unrelated lots.
  definition := pg_get_functiondef('public.get_collection_route_stage_metrics(uuid,uuid,text)'::regprocedure);
  needle := $old$JOIN public.production_stage_readings reading
        ON reading.piece_id = member.id
       AND public.normalize_route_step_code(reading.step_name) = v_step_code
       AND reading.status = 'approved'$old$;
  replacement := $new$JOIN LATERAL (
        SELECT scoped.step_name
        FROM public.production_stage_readings scoped
        WHERE scoped.piece_id = member.id AND scoped.status = 'approved'
        OFFSET 0
      ) reading ON public.normalize_route_step_code(reading.step_name) = v_step_code$new$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'STAGE_ROUTE_COST_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,replacement);
END;
$migration$;

-- Source: 20260920160859_replacement_reconcile_lock_scope.sql
-- Reconciliation only changes route/status fields of replacement pieces.
-- Ordinary pieces must not acquire a deferred FOR UPDATE lock at COMMIT.
-- Metadata-only projection updates do not alter the replacement trail.

DO $migration$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('public.reconcile_replacement_piece_trail(uuid)'::regprocedure);
  needle:='select * into v_piece from public.production_pieces where id = p_piece_id for update;';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'REPLACEMENT_LOCK_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,
    'select * into v_piece from public.production_pieces where id = p_piece_id and is_replacement is true for no key update;');
  definition:=pg_get_functiondef('public.sync_replacement_trail_from_reading()'::regprocedure);
  needle:=E'begin\n  if tg_op = ''UPDATE'' and old.piece_id is distinct from new.piece_id then';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'REPLACEMENT_TRIGGER_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,$new$begin
  if tg_op = 'UPDATE' and
    row(old.piece_id, old.step_name, old.status) is not distinct from
    row(new.piece_id, new.step_name, new.status) then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.piece_id is distinct from new.piece_id then$new$);
END;
$migration$;

-- Source: 20260920163159_scoped_piece_accounting.sql
-- Keep the accounting view's replacement-chain logic and SECURITY INVOKER/RLS,
-- but restrict root pieces BEFORE recursion. The unfiltered view remains intact.

DO $accounting$
DECLARE definition text; needle text;
BEGIN
  IF NOT coalesce((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class
    WHERE oid='public.production_piece_accounting'::regclass),false) THEN
    RAISE EXCEPTION 'ACCOUNTING_VIEW_SECURITY_MISMATCH';
  END IF;
  definition:=pg_get_viewdef('public.production_piece_accounting'::regclass,true);
  needle:='WHERE COALESCE(piece.is_replacement, false) IS FALSE';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'ACCOUNTING_SCOPE_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,needle||E'\n            AND (p_batch_id IS NULL OR piece.pcp_import_batch_id=p_batch_id)\n            AND (p_lot_id IS NULL OR piece.lot_id=p_lot_id)');
  EXECUTE format($sql$CREATE FUNCTION public.production_piece_accounting_for_scope(p_batch_id uuid,p_lot_id uuid)
    RETURNS TABLE(root_piece_id uuid,leaf_piece_id uuid,effective_piece_id uuid,
      open_replacement_id uuid,open_replacement_status text,replacement_pending boolean,replacement_depth integer)
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog,public AS %L$sql$,definition);
END;
$accounting$;
REVOKE ALL ON FUNCTION public.production_piece_accounting_for_scope(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_piece_accounting_for_scope(uuid,uuid) TO authenticated,service_role;

DO $routes$
DECLARE identity text; definition text; needle text;
  new_ctes text:=$ctes$),
route_arrays as materialized (
  select raw_route_steps as raw_steps from scoped_pieces
  union
  select raw_completed_steps from scoped_pieces
),
normalized_routes as materialized (
  select raw_steps, public.canonicalize_production_route(raw_steps) as normalized_steps
  from route_arrays
),
pieces as materialized (
  select scoped.*, route.normalized_steps as route_steps, completed.normalized_steps as completed_steps
  from scoped_pieces scoped
  join normalized_routes route on route.raw_steps is not distinct from scoped.raw_route_steps
  join normalized_routes completed on completed.raw_steps is not distinct from scoped.raw_completed_steps
),
piece_stage as ($ctes$;
BEGIN
  FOREACH identity IN ARRAY ARRAY['public.get_lot_route_stage_progress(uuid)',
    'private.get_lot_route_stage_progress_uncached_capacity(uuid)'] LOOP
    definition:=pg_get_functiondef(identity::regprocedure);
    IF position('pieces as materialized (' IN definition)=0
      OR position('public.canonicalize_production_route(root.route_steps) as route_steps' IN definition)=0
      OR position('public.production_piece_accounting accounting' IN definition)=0 THEN
      RAISE EXCEPTION 'BATCH_ROUTE_SOURCE_MISMATCH: %',identity;
    END IF;
    definition:=replace(definition,'public.production_piece_accounting accounting',
      'public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting');
    definition:=replace(definition,'pieces as materialized (','scoped_pieces as materialized (');
    definition:=replace(definition,'public.canonicalize_production_route(root.route_steps) as route_steps','root.route_steps as raw_route_steps');
    definition:=replace(definition,'public.canonicalize_production_route(effective.completed_steps) as completed_steps','effective.completed_steps as raw_completed_steps');
    needle:=E'),\npiece_stage as (';
    IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'ROUTE_CTE_SOURCE_MISMATCH'; END IF;
    -- The normalizer is STABLE. Equal arrays have the same result within a SQL
    -- snapshot; computing it once per distinct array avoids thousands of N+1 reads.
    EXECUTE replace(definition,needle,new_ctes);
  END LOOP;
  definition:=pg_get_functiondef('public.refresh_pcp_batch_progress(uuid)'::regprocedure);
  IF position('public.production_piece_accounting accounting' IN definition)=0 THEN RAISE EXCEPTION 'BATCH_ACCOUNTING_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,'public.production_piece_accounting accounting',
    'public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting');
  definition:=pg_get_functiondef('public.get_collection_lot_route_metrics(uuid)'::regprocedure);
  IF position('public.production_piece_accounting accounting' IN definition)=0 THEN RAISE EXCEPTION 'LOT_ACCOUNTING_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,'public.production_piece_accounting accounting',
    'public.production_piece_accounting_for_scope(NULL::uuid, p_lot_id) accounting');
END;
$routes$;

-- Source: 20260920164337_stage_member_route_normalization.sql
-- The same route/requirement tuple is shared by many pieces. Evaluate the
-- canonical routing rule once per distinct tuple, preserving its NULL behavior.

CREATE FUNCTION public.collection_stage_members_for_scope(
  p_batch_id uuid, p_lot_id uuid, p_step_code text
) RETURNS TABLE(id uuid, logical_piece_id uuid, status text,
  rework_status text, replacement_status text, is_replacement boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
WITH scoped AS MATERIALIZED (
  SELECT piece.id,coalesce(piece.original_piece_id,piece.id) logical_piece_id,
    piece.status,piece.rework_status,piece.replacement_status,
    coalesce(piece.is_replacement,false) is_replacement,
    piece.route_steps,piece.requires_cut,piece.requires_edge,piece.requires_cnc,
    piece.requires_joinery,piece.requires_separation,piece.requires_packaging
  FROM public.production_pieces piece
  JOIN public.production_lots lot ON lot.id=piece.lot_id
  WHERE coalesce(piece.is_active,true) IS TRUE
    AND piece.status NOT IN ('cancelled','shipped')
    AND (p_lot_id IS NULL OR piece.lot_id=p_lot_id)
    AND (p_batch_id IS NULL OR coalesce(piece.pcp_import_batch_id,lot.pcp_import_batch_id)=p_batch_id)
), routes AS MATERIALIZED (
  SELECT DISTINCT route_steps,requires_cut,requires_edge,requires_cnc,
    requires_joinery,requires_separation,requires_packaging FROM scoped
), required AS MATERIALIZED (
  SELECT * FROM routes WHERE public.piece_requires_routing_step(p_step_code,
    route_steps,requires_cut,requires_edge,requires_cnc,
    requires_joinery,requires_separation,requires_packaging)
)
SELECT scoped.id,scoped.logical_piece_id,scoped.status,scoped.rework_status,
  scoped.replacement_status,scoped.is_replacement
FROM scoped JOIN required ON
  ROW(scoped.route_steps,scoped.requires_cut,scoped.requires_edge,scoped.requires_cnc,
    scoped.requires_joinery,scoped.requires_separation,scoped.requires_packaging)
  IS NOT DISTINCT FROM
  ROW(required.route_steps,required.requires_cut,required.requires_edge,required.requires_cnc,
    required.requires_joinery,required.requires_separation,required.requires_packaging);
$fn$;
REVOKE ALL ON FUNCTION public.collection_stage_members_for_scope(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collection_stage_members_for_scope(uuid,uuid,text) TO authenticated,service_role;
DO $patch$
DECLARE definition text; marker text; start_at integer; end_at integer;
BEGIN
  definition:=pg_get_functiondef('public.get_collection_route_stage_metrics(uuid,uuid,text)'::regprocedure);
  FOREACH marker IN ARRAY ARRAY[E'),\n    approved_slots AS (',E'),\n  slots AS ('] LOOP
    start_at:=position('WITH members AS (' IN definition);
    end_at:=position(marker IN definition);
    IF start_at=0 OR end_at<=start_at
      OR position('public.piece_requires_routing_step(' IN substring(definition FROM start_at FOR end_at-start_at))=0
      THEN RAISE EXCEPTION 'STAGE_MEMBER_SOURCE_MISMATCH'; END IF;
    definition:=left(definition,start_at-1)
      ||'WITH members AS MATERIALIZED (SELECT * FROM public.collection_stage_members_for_scope(v_batch_id,p_lot_id,v_step_code)'
      ||substring(definition FROM end_at);
  END LOOP;
  EXECUTE definition;
END;
$patch$;

-- Source: 20260920164812_piece_read_scope_initplan.sql
-- Preserve the existing access predicates, evaluating shared lot/order access
-- once per statement instead of once for each piece in a large production lot.

CREATE FUNCTION public.current_profile_readable_lot_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT lot.id FROM public.production_lots lot
  WHERE (SELECT auth.uid()) IS NOT NULL AND public.can_access_production_lot(lot.id);
$fn$;
CREATE FUNCTION public.current_profile_readable_order_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT orders.id FROM public.production_orders orders
  WHERE (SELECT auth.uid()) IS NOT NULL AND public.can_access_production_order(orders.id);
$fn$;
CREATE FUNCTION public.current_profile_readable_recorded_piece_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  WITH names AS MATERIALIZED (
    SELECT DISTINCT cell_name FROM public.production_stage_readings
    WHERE (SELECT auth.uid()) IS NOT NULL
  ), allowed AS MATERIALIZED (
    SELECT cell_name FROM names WHERE public.profile_can_access_cell(cell_name)
  )
  SELECT DISTINCT reading.piece_id FROM public.production_stage_readings reading
  JOIN allowed ON allowed.cell_name=reading.cell_name
  WHERE reading.piece_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.current_profile_readable_lot_ids(),
  public.current_profile_readable_order_ids(),public.current_profile_readable_recorded_piece_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_readable_lot_ids(),
  public.current_profile_readable_order_ids(),public.current_profile_readable_recorded_piece_ids()
  TO anon,authenticated,service_role;
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='production_pieces' AND policyname='production_pieces_scoped_read'
    AND cmd='SELECT' AND qual='can_access_production_piece(id)') THEN
    RAISE EXCEPTION 'PIECE_READ_POLICY_SOURCE_MISMATCH';
  END IF;
END;
$guard$;
ALTER POLICY production_pieces_scoped_read ON public.production_pieces USING (
  (SELECT auth.uid()) IS NOT NULL AND (
    (SELECT public.current_profile_has_global_cell_access())
    OR lot_id IN (SELECT public.current_profile_readable_lot_ids())
    OR production_order_id IN (SELECT public.current_profile_readable_order_ids())
    OR id IN (SELECT public.current_profile_readable_recorded_piece_ids())
  )
);

-- Source: 20260926131946_setwise_read_authorization.sql
-- Calculate the same authorization sets once, without checking a profile for
-- every historical reading. The existing global and cell predicates remain
-- authoritative; this does not grant access through a new role or bypass RLS.

CREATE FUNCTION private.current_profile_authorized_cells() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  WITH candidates AS MATERIALIZED (
    SELECT DISTINCT unnest(CASE
      WHEN array_length(coalesce(profile.managed_cells, '{}'::text[]), 1) IS NULL
        AND nullif(btrim(profile.cell), '') IS NOT NULL
      THEN ARRAY[profile.cell]
      ELSE coalesce(profile.managed_cells, '{}'::text[])
    END) AS cell_name
    FROM public.profiles profile WHERE profile.id=(SELECT auth.uid())
  )
  SELECT cell_name FROM candidates WHERE public.profile_can_access_cell(cell_name);
$fn$;
REVOKE ALL ON FUNCTION private.current_profile_authorized_cells() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.current_profile_readable_lot_ids() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN; END IF;
  IF public.current_profile_has_global_cell_access() THEN
    RETURN QUERY SELECT id FROM public.production_lots;
    RETURN;
  END IF;
  RETURN QUERY
    WITH allowed AS MATERIALIZED (SELECT private.current_profile_authorized_cells() AS name),
    accessible AS (
      SELECT lot.id FROM public.production_lots lot JOIN allowed ON allowed.name=lot.current_cell
      UNION
      SELECT item.lot_id FROM public.production_lot_items item JOIN allowed ON allowed.name=item.current_cell
      UNION
      SELECT route.lot_id FROM public.production_routes route JOIN allowed ON allowed.name=route.cell_name
      UNION
      SELECT reading.lot_id FROM public.production_stage_readings reading JOIN allowed ON allowed.name=reading.cell_name
      UNION
      SELECT event.lot_id FROM public.production_collection_events event JOIN allowed ON allowed.name=event.cell_name
      UNION
      SELECT lot.id FROM public.production_entries entry JOIN allowed ON allowed.name=entry.cell
      JOIN public.production_lots lot ON coalesce(lot.production_order_id,lot.order_id)=entry.production_order_id
    )
    SELECT lot.id FROM public.production_lots lot JOIN accessible ON accessible.id=lot.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.current_profile_readable_order_ids() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN; END IF;
  IF public.current_profile_has_global_cell_access() THEN
    RETURN QUERY SELECT id FROM public.production_orders;
    RETURN;
  END IF;
  RETURN QUERY
    WITH allowed AS MATERIALIZED (SELECT private.current_profile_authorized_cells() AS name),
    allowed_lots AS MATERIALIZED (SELECT public.current_profile_readable_lot_ids() AS id),
    accessible AS (
      SELECT entry.production_order_id AS id FROM public.production_entries entry
      JOIN allowed ON allowed.name=entry.cell
      UNION
      SELECT coalesce(lot.production_order_id,lot.order_id) FROM public.production_lots lot
      JOIN allowed_lots ON allowed_lots.id=lot.id
    )
    SELECT orders.id FROM public.production_orders orders JOIN accessible ON accessible.id=orders.id;
END;
$fn$;

-- Source: 20260926132209_grouped_lot_tracking.sql
-- Preserve row-level authorization, forecast rules and output while reducing
-- intermediate rows by grouping pieces with identical route and state.

CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_base(p_batch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where (p_batch_id is not null and b.id = p_batch_id)
     or (
       p_batch_id is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
selected_piece_rows as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
-- Equal route/state groups have equal stage results. Retain their multiplicity
-- instead of expanding every individual piece into four intermediate rows.
selected_pieces as materialized (
  select min(p.id::text)::uuid as id, p.pcp_import_batch_id, p.lot_id,
    p.requires_cut, p.requires_edge, p.requires_cnc, p.requires_joinery,
    p.manual_joinery, p.route_steps, p.completed_steps, p.is_blocked,
    p.rework_status, p.replacement_status, count(*)::bigint as piece_weight
  from selected_piece_rows p
  group by p.pcp_import_batch_id, p.lot_id, p.requires_cut, p.requires_edge,
    p.requires_cnc, p.requires_joinery, p.manual_joinery, p.route_steps,
    p.completed_steps, p.is_blocked, p.rework_status, p.replacement_status
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    p.piece_weight,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when p_batch_id is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$function$;


-- Source: 20260926132334_shared_read_policy_scopes.sql
-- Reuse the caller's exact authorization sets in SELECT policies. Write
-- policies and predicates for legacy readings with no physical cell are kept.

CREATE FUNCTION public.current_profile_readable_cell_names() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT private.current_profile_authorized_cells();
$fn$;
REVOKE ALL ON FUNCTION public.current_profile_readable_cell_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_readable_cell_names() TO anon,authenticated,service_role;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='production_lots' AND policyname='production_lots_scoped_read'
    AND cmd='SELECT' AND qual='can_access_production_lot(id)')
  OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='production_orders' AND policyname='production_orders_scoped_read'
    AND cmd='SELECT' AND qual='can_access_production_order(id)')
  OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='production_stage_readings' AND policyname='production_stage_readings_scoped_read'
    AND cmd='SELECT' AND qual=$expected$(current_profile_has_global_cell_access() OR profile_can_access_cell(cell_name) OR ((NULLIF(btrim(cell_name), ''::text) IS NULL) AND (piece_id IS NOT NULL) AND can_access_production_piece(piece_id)) OR ((NULLIF(btrim(cell_name), ''::text) IS NULL) AND (piece_id IS NULL) AND can_access_production_lot(lot_id)))$expected$)
  THEN RAISE EXCEPTION 'READ_SCOPE_POLICY_SOURCE_MISMATCH'; END IF;
END;
$guard$;
ALTER POLICY production_lots_scoped_read ON public.production_lots
  USING (id IN (SELECT public.current_profile_readable_lot_ids()));
ALTER POLICY production_orders_scoped_read ON public.production_orders
  USING (id IN (SELECT public.current_profile_readable_order_ids()));
ALTER POLICY production_stage_readings_scoped_read ON public.production_stage_readings USING (
  (SELECT public.current_profile_has_global_cell_access())
  OR cell_name IN (SELECT public.current_profile_readable_cell_names())
  OR (nullif(btrim(cell_name),'') IS NULL AND piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
  OR (nullif(btrim(cell_name),'') IS NULL AND piece_id IS NULL AND public.can_access_production_lot(lot_id))
);

-- Source: 20260926133308_shared_batch_stage_snapshots.sql
-- A batch/stage KPI is independent of physical cell. Refresh every stage in
-- one scoped pass, then share that result between authorized stations. The
-- station's active lot/context remains separate and is still scope-checked.

CREATE TABLE private.collection_shared_batch_stage_snapshots (
  pcp_import_batch_id uuid NOT NULL REFERENCES public.promob_import_batches(id) ON DELETE CASCADE,
  step_code text NOT NULL,
  expected_count bigint NOT NULL, approved_count bigint NOT NULL,
  pending_count bigint NOT NULL, rejected_count bigint NOT NULL,
  rework_count bigint NOT NULL, replacement_count bigint NOT NULL,
  state_version bigint NOT NULL,
  source_batch_updated_at timestamptz,
  snapshot_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(pcp_import_batch_id,step_code)
);
ALTER TABLE private.collection_shared_batch_stage_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.collection_shared_batch_stage_snapshots FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.collection_batch_stage_metrics(p_batch_id uuid)
RETURNS TABLE(step_code text,expected_count bigint,approved_count bigint,pending_count bigint,
  rejected_count bigint,rework_count bigint,replacement_count bigint)
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
WITH progress AS MATERIALIZED (
  SELECT public.get_lot_route_stage_progress(p_batch_id) AS value
), stages AS MATERIALIZED (
  SELECT public.normalize_route_step_code(stage.value->>'stage_code') AS code,stage.value
  FROM progress CROSS JOIN LATERAL jsonb_array_elements(progress.value->'batch_stages') stage(value)
), scoped AS MATERIALIZED (
  SELECT piece.id,coalesce(piece.original_piece_id,piece.id) logical_piece_id,
    piece.status,piece.rework_status,piece.replacement_status,
    coalesce(piece.is_replacement,false) is_replacement,
    piece.route_steps,piece.requires_cut,piece.requires_edge,piece.requires_cnc,
    piece.requires_joinery,piece.requires_separation,piece.requires_packaging
  FROM public.production_pieces piece JOIN public.production_lots lot ON lot.id=piece.lot_id
  WHERE coalesce(piece.is_active,true) IS TRUE AND piece.status NOT IN ('cancelled','shipped')
    AND coalesce(piece.pcp_import_batch_id,lot.pcp_import_batch_id)=p_batch_id
), exception_slots AS MATERIALIZED (
  -- A slot with no rejected/rework/replacement member contributes zero to
  -- these three counters. Keep ALL members of any exceptional slot so a
  -- completed replacement still cancels its original pending/rejected state.
  SELECT DISTINCT logical_piece_id FROM scoped WHERE status IN (
    'rejected','rework','rework_pending','rework_in_progress','replacement_requested','replacement_in_production')
    OR rework_status IN ('pending','in_progress')
    OR replacement_status IN ('requested','in_production')
), exception_members AS MATERIALIZED (
  SELECT * FROM scoped WHERE logical_piece_id IN (SELECT logical_piece_id FROM exception_slots)
), routes AS MATERIALIZED (
  SELECT DISTINCT route_steps,requires_cut,requires_edge,requires_cnc,requires_joinery,
    requires_separation,requires_packaging FROM exception_members
), required AS MATERIALIZED (
  SELECT stages.code,routes.* FROM stages CROSS JOIN routes
  WHERE stages.code IS NOT NULL AND public.piece_requires_routing_step(stages.code,
    routes.route_steps,routes.requires_cut,routes.requires_edge,routes.requires_cnc,
    routes.requires_joinery,routes.requires_separation,routes.requires_packaging)
), slots AS (
  SELECT required.code,member.logical_piece_id,
    bool_or(member.status='rejected') AND NOT bool_or(member.replacement_status='replaced'
      OR (member.is_replacement AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped'))) rejected_open,
    bool_or(member.rework_status IN ('pending','in_progress')
      OR member.status IN ('rework','rework_pending','rework_in_progress')) rework_open,
    bool_or(member.replacement_status IN ('requested','in_production')
      OR member.status IN ('replacement_requested','replacement_in_production'))
      AND NOT bool_or(member.replacement_status='replaced'
        OR (member.is_replacement AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped'))) replacement_open
  FROM exception_members member JOIN required ON
    ROW(member.route_steps,member.requires_cut,member.requires_edge,member.requires_cnc,
      member.requires_joinery,member.requires_separation,member.requires_packaging)
    IS NOT DISTINCT FROM
    ROW(required.route_steps,required.requires_cut,required.requires_edge,required.requires_cnc,
      required.requires_joinery,required.requires_separation,required.requires_packaging)
  GROUP BY required.code,member.logical_piece_id
), counts AS (
  SELECT code,count(*) FILTER(WHERE rejected_open)::bigint rejected,
    count(*) FILTER(WHERE rework_open)::bigint rework,
    count(*) FILTER(WHERE replacement_open)::bigint replacement FROM slots GROUP BY code
)
SELECT stages.code,coalesce((value->>'required_pieces')::bigint,0),
  coalesce((value->>'effective_completed_pieces')::bigint,0),
  coalesce((value->>'remaining_pieces')::bigint,
    greatest(coalesce((value->>'required_pieces')::bigint,0)-coalesce((value->>'effective_completed_pieces')::bigint,0),0)),
  coalesce(counts.rejected,0),coalesce(counts.rework,0),coalesce(counts.replacement,0)
FROM stages LEFT JOIN counts ON counts.code=stages.code WHERE stages.code IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION private.collection_batch_stage_metrics(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.collection_batch_stage_metrics(uuid) TO service_role;

CREATE FUNCTION private.refresh_shared_collection_batch_snapshot(p_batch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $fn$
DECLARE revision timestamptz; started timestamptz:=clock_timestamp();
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT collection_snapshot_updated_at INTO STRICT revision FROM public.promob_import_batches WHERE id=p_batch_id;
  INSERT INTO private.collection_shared_batch_stage_snapshots AS cached (
    pcp_import_batch_id,step_code,expected_count,approved_count,pending_count,
    rejected_count,rework_count,replacement_count,state_version,source_batch_updated_at,snapshot_at
  )
  SELECT p_batch_id,metrics.step_code,metrics.expected_count,metrics.approved_count,metrics.pending_count,
    metrics.rejected_count,metrics.rework_count,metrics.replacement_count,
    coalesce((SELECT max(old.state_version) FROM private.collection_dashboard_batch_snapshots old
      WHERE old.pcp_import_batch_id=p_batch_id AND old.step_code=metrics.step_code),0)+1,
    revision,started FROM private.collection_batch_stage_metrics(p_batch_id) metrics
  ON CONFLICT(pcp_import_batch_id,step_code) DO UPDATE SET
    expected_count=excluded.expected_count,approved_count=excluded.approved_count,pending_count=excluded.pending_count,
    rejected_count=excluded.rejected_count,rework_count=excluded.rework_count,replacement_count=excluded.replacement_count,
    state_version=greatest(cached.state_version+1,excluded.state_version),
    source_batch_updated_at=excluded.source_batch_updated_at,snapshot_at=excluded.snapshot_at,updated_at=clock_timestamp()
  WHERE cached.snapshot_at<=excluded.snapshot_at
    AND coalesce(cached.source_batch_updated_at,'-infinity'::timestamptz)<=coalesce(excluded.source_batch_updated_at,'-infinity'::timestamptz);
END;
$fn$;
REVOKE ALL ON FUNCTION private.refresh_shared_collection_batch_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_shared_collection_batch_snapshot(uuid) TO service_role;

DO $patch$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure);
  needle:=$old$    SELECT DISTINCT pcp_import_batch_id, cell_name, step_code
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY pcp_import_batch_id, cell_name, step_code
  LOOP
    PERFORM private.refresh_collection_dashboard_batch_snapshot(
      v_item.pcp_import_batch_id, v_item.cell_name, v_item.step_code
    );$old$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'SHARED_BATCH_PROJECTOR_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,$new$    SELECT DISTINCT pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL ORDER BY pcp_import_batch_id
  LOOP
    PERFORM private.refresh_shared_collection_batch_snapshot(v_item.pcp_import_batch_id);$new$);

  definition:=pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure);
  needle:='      AND cache.cell_name = lower(btrim(p_cell_name))';
  IF position(needle IN definition)=0 OR position('FROM private.collection_dashboard_batch_snapshots cache' IN definition)=0
    THEN RAISE EXCEPTION 'SHARED_BATCH_READER_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,'');
  definition:=replace(definition,'collection_dashboard_batch_snapshots','collection_shared_batch_stage_snapshots');
  EXECUTE definition;
END;
$patch$;

-- Source: 20260926134442_coalesced_batch_projection_order.sql
-- Projectors previously refreshed a PCP batch from each client lot, acquiring
-- batch row locks in client-lot UUID order. Two workers could therefore lock
-- the same batches in opposite orders. Refresh each batch once, in UUID order,
-- after its lot states have been written. Standalone/legacy refreshes remain.

DO $patch$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('public.refresh_collection_lot_state(uuid,uuid)'::regprocedure);
  needle:='PERFORM public.refresh_pcp_batch_progress(v_lot.pcp_import_batch_id);';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'LOT_BATCH_REFRESH_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,$new$IF NOT (
      coalesce(auth.role(),'')='service_role'
      AND coalesce(current_setting('acprod.collection_v3_projection_cache',true),'')='on'
    ) THEN
      PERFORM public.refresh_pcp_batch_progress(v_lot.pcp_import_batch_id);
    END IF;$new$);

  definition:=pg_get_functiondef('private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure);
  needle:=$old$    SELECT DISTINCT success.pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success success
    WHERE success.pcp_import_batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.production_lots lot
        JOIN pg_temp.collection_v3_projection_success refreshed ON refreshed.lot_id = lot.id
        WHERE lot.pcp_import_batch_id = success.pcp_import_batch_id
      )
    ORDER BY success.pcp_import_batch_id$old$;
  IF position(needle IN definition)=0
    THEN RAISE EXCEPTION 'PROJECTOR_BATCH_REFRESH_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,$new$    SELECT batch_id AS pcp_import_batch_id FROM (
      SELECT success.pcp_import_batch_id AS batch_id FROM pg_temp.collection_v3_projection_success success
      WHERE success.pcp_import_batch_id IS NOT NULL
      UNION
      SELECT lot.pcp_import_batch_id FROM public.production_lots lot
      JOIN pg_temp.collection_v3_projection_success success ON success.lot_id=lot.id
      WHERE lot.pcp_import_batch_id IS NOT NULL
    ) affected_batches ORDER BY batch_id$new$);
  needle:=$old$    SELECT DISTINCT pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL ORDER BY pcp_import_batch_id$old$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'PROJECTOR_SHARED_SNAPSHOT_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,$new$    SELECT batch_id AS pcp_import_batch_id FROM (
      SELECT success.pcp_import_batch_id AS batch_id FROM pg_temp.collection_v3_projection_success success
      WHERE success.pcp_import_batch_id IS NOT NULL
      UNION
      SELECT lot.pcp_import_batch_id FROM public.production_lots lot
      JOIN pg_temp.collection_v3_projection_success success ON success.lot_id=lot.id
      WHERE lot.pcp_import_batch_id IS NOT NULL
    ) affected_batches ORDER BY batch_id$new$);
  EXECUTE definition;
END;
$patch$;

-- Source: 20260926140200_history_cell_prefilter.sql
-- Restrict the driving event relation before joining piece/lot metadata.
-- The original COALESCE predicate remains authoritative. NULL event cells
-- still fall back to the reading cell, including all legacy records.
-- EXPLAIN in the real lab: history 20.677 -> 9.382 ms; count 9.027 -> 5.605 ms.
-- Reuses existing cell indexes; adds no write amplification.

DO $patch$
DECLARE item record; definition text;
  needle text := 'WHERE (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''''))) = lower(trim(p_cell_name)))';
  replacement text := 'WHERE (p_cell_name IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim(p_cell_name)))
      AND (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''''))) = lower(trim(p_cell_name)))';
BEGIN
  FOR item IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('get_collection_history_impl','get_collection_history_count_impl')
  LOOP
    definition:=pg_get_functiondef(item.oid);
    IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'HISTORY_PREFILTER_SOURCE_MISMATCH'; END IF;
    EXECUTE replace(definition,needle,replacement);
  END LOOP;
END;
$patch$;

-- Source: 20260926140210_authorization_scope_cardinality.sql
-- This planner estimate is NOT a row limit. Every authorized cell is returned.
-- Avoid assuming 1000 cells per profile, which forced full history hash joins
-- despite existing cell indexes. Actual local plan: 20.777 -> 9.423 ms.

ALTER FUNCTION private.current_profile_authorized_cells() ROWS 10;
ALTER FUNCTION public.current_profile_readable_cell_names() ROWS 10;

-- Source: 20260926140900_history_bound_custom_plans.sql
-- Plan history queries for the actual optional filters. Values remain bound
-- parameters, authorization wrappers and all business predicates are unchanged.

DO $guard$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_collection_history_impl' AND md5(pg_get_functiondef(oid))='ac60098452bd0a30399d83c9fa896aee') THEN RAISE EXCEPTION 'HISTORY_CUSTOM_PLAN_SOURCE_MISMATCH'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_collection_history_count_impl' AND md5(pg_get_functiondef(oid))='87629518e25d348fc2c65c2ea9d087bf') THEN RAISE EXCEPTION 'HISTORY_CUSTOM_PLAN_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.get_collection_history_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, event_id uuid, client_event_id text, created_at timestamp with time zone, server_created_at timestamp with time zone, processed_at timestamp with time zone, date date, hour text, traceability_code text, raw_value text, piece_id uuid, piece_name text, pcp_import_batch_id uuid, pcp_batch_name text, lot_id uuid, lot_code text, order_number text, client_name text, current_stage_name text, operation_name text, operator_id uuid, operator_name text, registration text, cell_name text, machine_id uuid, machine_name text, station_name text, shift text, reader_type text, event_status text, result_status text, sync_status text, message text, route_steps text[], completed_steps text[], result_payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
RETURN QUERY EXECUTE $query$  WITH history AS (
    SELECT
      e.id,
      e.id AS event_id,
      e.client_event_id,
      COALESCE(e.created_at_client, e.created_at) AS created_at,
      e.created_at AS server_created_at,
      e.processed_at,
      e.date,
      e.hour,
      COALESCE(NULLIF(e.piece_code, ''), p.traceability_code, p.piece_uid,
               NULLIF(e.normalized_value, ''), e.raw_value) AS traceability_code,
      e.raw_value,
      COALESCE(e.piece_id, sr.piece_id) AS piece_id,
      p.piece_name,
      COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id) AS pcp_import_batch_id,
      COALESCE(batch.general_lot_code, batch.file_name) AS pcp_batch_name,
      COALESCE(e.lot_id, sr.lot_id, p.lot_id) AS lot_id,
      COALESCE(NULLIF(e.lot_code, ''), NULLIF(sr.lot_code, ''),
               NULLIF(p.lot_code, ''), l.lot_code) AS lot_code,
      COALESCE(NULLIF(e.order_number, ''), NULLIF(sr.order_number, ''),
               NULLIF(p.order_number, ''), po.order_number, po.order_code) AS order_number,
      COALESCE(NULLIF(e.customer_name, ''), NULLIF(sr.customer_name, ''),
               NULLIF(p.customer_name, ''), po.customer_name) AS client_name,
      COALESCE(NULLIF(e.operation_name, ''),
               NULLIF(e.result_payload #>> '{route,step_name}', ''),
               NULLIF(e.result_payload #>> '{result,route,step_name}', ''),
               NULLIF(sr.step_name, ''), NULLIF(sr.operation_name, ''),
               NULLIF(e.cell_name, ''), NULLIF(sr.cell_name, '')) AS current_stage_name,
      COALESCE(NULLIF(sr.operation_name, ''), NULLIF(e.operation_name, ''), sr.step_name) AS operation_name,
      e.operator_id,
      COALESCE(e.operator_name, op.name, sr.operator) AS operator_name,
      COALESCE(e.registration, op.registration) AS registration,
      COALESCE(e.cell_name, sr.cell_name) AS cell_name,
      COALESCE(e.machine_id, sr.machine_id) AS machine_id,
      COALESCE(e.machine_name, sr.machine_name) AS machine_name,
      COALESCE(e.station_name, sr.station_name) AS station_name,
      COALESCE(e.shift, sr.shift) AS shift,
      e.reader_type,
      CASE
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
      END AS event_status,
      e.result_status,
      e.status AS sync_status,
      COALESCE(e.result_payload->>'message', e.error_message) AS message,
      COALESCE(p.route_steps, '{}'::text[]) AS route_steps,
      COALESCE(p.completed_steps, '{}'::text[]) AS completed_steps,
      e.result_payload
    FROM public.production_collection_events e
    LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
    LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
    LEFT JOIN public.promob_import_batches batch
      ON batch.id = COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id)
    LEFT JOIN public.production_lots l
      ON l.id = COALESCE(e.lot_id, sr.lot_id, p.lot_id)
    LEFT JOIN public.production_orders po
      ON po.id = COALESCE(e.production_order_id, p.production_order_id,
                          l.production_order_id, l.order_id)
    LEFT JOIN public.operators op ON op.id = e.operator_id
    WHERE ($11 IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim($11)))
      AND ($11 IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim($11)))
      AND ($1 IS NULL OR EXISTS (
        SELECT 1 FROM public.cells c
        WHERE c.id = $1
          AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
      ))
      AND ($2 IS NULL OR COALESCE(e.machine_id, sr.machine_id) = $2)
      AND ($3 IS NULL OR e.operator_id = $3)
      AND ($4 IS NULL OR COALESCE(e.shift, sr.shift) = $4)
      AND ($6 IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = $6)
      AND ($9 IS NULL OR COALESCE(e.created_at_client, e.created_at) >= $9)
      AND ($10 IS NULL OR COALESCE(e.created_at_client, e.created_at) <= $10)
  )
  SELECT * FROM history h
  WHERE
    -- Filtro: 'approved' inclui tanto 'approved' quanto 'approved_via_replacement'
    CASE
      WHEN $5 = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
      WHEN $5 IS NULL THEN true
      ELSE h.event_status = $5
    END
  ORDER BY h.created_at DESC, h.server_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE($7, 50), 1), 500)
  OFFSET GREATEST(COALESCE($8, 0), 0);
$query$ USING p_cell_id,p_workstation_id,p_operator_id,p_shift,p_status,p_lot_id,p_limit,p_offset,p_date_from,p_date_to,p_cell_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_collection_history_count_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result bigint;
BEGIN
EXECUTE $query$  WITH history AS (
  SELECT CASE
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
      END AS event_status
  FROM public.production_collection_events e
  LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
  LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
  WHERE ($9 IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim($9)))
      AND ($9 IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim($9)))
    AND ($1 IS NULL OR EXISTS (
      SELECT 1 FROM public.cells c
      WHERE c.id = $1
        AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
    ))
    AND ($2 IS NULL OR COALESCE(e.machine_id, sr.machine_id) = $2)
    AND ($3 IS NULL OR e.operator_id = $3)
    AND ($4 IS NULL OR COALESCE(e.shift, sr.shift) = $4)
    AND ($6 IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = $6)
    AND ($7 IS NULL OR COALESCE(e.created_at_client, e.created_at) >= $7)
    AND ($8 IS NULL OR COALESCE(e.created_at_client, e.created_at) <= $8)
  )
  SELECT count(*) FROM history h
  WHERE CASE
    WHEN $5 = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
    WHEN $5 IS NULL THEN true
    ELSE h.event_status = $5
  END;
$query$ INTO result USING p_cell_id,p_workstation_id,p_operator_id,p_shift,p_status,p_lot_id,p_date_from,p_date_to,p_cell_name;
RETURN result;
END;
$function$;


-- Source: 20260926141900_authorized_tracking_group_snapshots.sql
-- The lot overview was regrouping tens of thousands of pieces for every
-- observer. Prepare the exact same groups once in the asynchronous projector.
-- Partial authorization, absent snapshots or stale revisions use the original
-- RLS-protected query. No result is inferred from an uncommitted scan.

CREATE TABLE private.collection_tracking_group_snapshots (
  pcp_import_batch_id uuid PRIMARY KEY REFERENCES public.promob_import_batches(id) ON DELETE CASCADE,
  piece_groups jsonb NOT NULL,
  required_lot_ids uuid[] NOT NULL,
  has_unassigned_lot boolean NOT NULL,
  source_batch_updated_at timestamptz,
  snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.collection_tracking_group_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.collection_tracking_group_snapshots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.refresh_tracking_group_snapshot(p_batch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $fn$
DECLARE revision timestamptz; started timestamptz:=clock_timestamp();
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT collection_snapshot_updated_at INTO STRICT revision FROM public.promob_import_batches WHERE id=p_batch_id;
  INSERT INTO private.collection_tracking_group_snapshots
    (pcp_import_batch_id,piece_groups,required_lot_ids,has_unassigned_lot,source_batch_updated_at,snapshot_at)
  WITH grouped AS MATERIALIZED (
    SELECT min(p.id::text)::uuid AS id,p.pcp_import_batch_id,p.lot_id,
      p.requires_cut,p.requires_edge,p.requires_cnc,p.requires_joinery,
      p.manual_joinery,p.route_steps,p.completed_steps,p.is_blocked,
      p.rework_status,p.replacement_status,count(*)::bigint AS piece_weight
    FROM public.production_pieces p
    WHERE p.pcp_import_batch_id=p_batch_id
      AND lower(coalesce(p.status,'')) NOT IN ('cancelled','canceled','replaced')
    GROUP BY p.pcp_import_batch_id,p.lot_id,p.requires_cut,p.requires_edge,
      p.requires_cnc,p.requires_joinery,p.manual_joinery,p.route_steps,
      p.completed_steps,p.is_blocked,p.rework_status,p.replacement_status
  )
  SELECT p_batch_id,coalesce(jsonb_agg(to_jsonb(g)),'[]'),
    coalesce(array_agg(DISTINCT lot_id) FILTER(WHERE lot_id IS NOT NULL),'{}'::uuid[]),
    coalesce(bool_or(lot_id IS NULL),false),revision,started FROM grouped g
  ON CONFLICT(pcp_import_batch_id) DO UPDATE SET
    piece_groups=excluded.piece_groups,required_lot_ids=excluded.required_lot_ids,
    has_unassigned_lot=excluded.has_unassigned_lot,
    source_batch_updated_at=excluded.source_batch_updated_at,snapshot_at=excluded.snapshot_at
  WHERE coalesce(excluded.source_batch_updated_at,'-infinity'::timestamptz)
    >=coalesce(collection_tracking_group_snapshots.source_batch_updated_at,'-infinity'::timestamptz)
    AND excluded.snapshot_at>=collection_tracking_group_snapshots.snapshot_at;
END;
$fn$;
REVOKE ALL ON FUNCTION private.refresh_tracking_group_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_tracking_group_snapshot(uuid) TO service_role;

CREATE FUNCTION public.get_authorized_tracking_group_snapshots(p_batch_ids uuid[])
RETURNS TABLE(pcp_import_batch_id uuid,piece_groups jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $fn$
  WITH access_scope AS MATERIALIZED (
    SELECT (SELECT auth.uid()) AS user_id,
      public.current_profile_has_global_cell_access() AS global_access,
      ARRAY(SELECT public.current_profile_readable_lot_ids()) AS lot_ids
  )
  SELECT snapshot.pcp_import_batch_id,snapshot.piece_groups
  FROM private.collection_tracking_group_snapshots snapshot
  JOIN public.promob_import_batches batch ON batch.id=snapshot.pcp_import_batch_id
    AND batch.collection_snapshot_updated_at IS NOT DISTINCT FROM snapshot.source_batch_updated_at
  CROSS JOIN access_scope access
  WHERE snapshot.pcp_import_batch_id=ANY(p_batch_ids) AND access.user_id IS NOT NULL
    AND (access.global_access OR (
      NOT snapshot.has_unassigned_lot AND cardinality(snapshot.required_lot_ids)>0
      AND snapshot.required_lot_ids <@ access.lot_ids
    ));
$fn$;
REVOKE ALL ON FUNCTION public.get_authorized_tracking_group_snapshots(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_authorized_tracking_group_snapshots(uuid[]) TO authenticated,service_role;

DO $patch$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('private.refresh_shared_collection_batch_snapshot(uuid)'::regprocedure);
  needle:=E'END;\n';
  IF position('FROM private.collection_batch_stage_metrics(p_batch_id)' IN definition)=0 THEN
    RAISE EXCEPTION 'TRACKING_SNAPSHOT_PROJECTOR_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,E'  PERFORM private.refresh_tracking_group_snapshot(p_batch_id);\nEND;\n');

  definition:=pg_get_functiondef('public.get_general_lot_tracking_base(uuid,integer)'::regprocedure);
  needle:='selected_piece_rows as (';
  IF position(needle IN definition)=0 OR position('p.piece_weight' IN definition)=0 THEN
    RAISE EXCEPTION 'TRACKING_SNAPSHOT_READER_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,$new$cached_piece_groups as materialized (
  select * from public.get_authorized_tracking_group_snapshots(array(select id from selected_batches))
),
selected_piece_rows as ($new$);
  needle:=$old$where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')$old$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'TRACKING_SNAPSHOT_FILTER_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,needle||E'\n    and not exists(select 1 from cached_piece_groups cache where cache.pcp_import_batch_id=p.pcp_import_batch_id)');
  needle:=E'),\npiece_stage as (';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'TRACKING_SNAPSHOT_GROUP_SOURCE_MISMATCH'; END IF;
  definition:=replace(definition,needle,$new$  union all
  select grouped.* from cached_piece_groups cache
  cross join lateral jsonb_to_recordset(cache.piece_groups) as grouped(
    id uuid,pcp_import_batch_id uuid,lot_id uuid,
    requires_cut boolean,requires_edge boolean,requires_cnc boolean,requires_joinery boolean,
    manual_joinery boolean,route_steps text[],completed_steps text[],is_blocked boolean,
    rework_status text,replacement_status text,piece_weight bigint
  )
),
piece_stage as ($new$);
  EXECUTE definition;
END;
$patch$;

-- Source: 20260926142300_tracking_scope_bound_plans.sql
-- Bind the same authorized IDs used by RLS so existing indexes can restrict
-- partial scopes before grouping. RLS stays enabled on the underlying query.
-- Complete fresh caches bypass the piece scan via a one-time condition.

DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.get_general_lot_tracking_base(uuid,integer)'::regprocedure))<>'95ef60a2660e84cfc5e2035abf791a5f' THEN RAISE EXCEPTION 'TRACKING_BOUND_SCOPE_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_base(p_batch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE statement text:=$query$with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where ($1 is not null and b.id = $1)
     or (
       $1 is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce($2, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
cached_piece_groups as materialized (
  select * from public.get_authorized_tracking_group_snapshots(array(select id from selected_batches))
),
selected_piece_rows as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
    and (select count(*) from cached_piece_groups) <> (select count(*) from selected_batches)
    /* authorized_piece_lookup */
    and not exists(select 1 from cached_piece_groups cache where cache.pcp_import_batch_id=p.pcp_import_batch_id)
),
-- Equal route/state groups have equal stage results. Retain their multiplicity
-- instead of expanding every individual piece into four intermediate rows.
selected_pieces as materialized (
  select min(p.id::text)::uuid as id, p.pcp_import_batch_id, p.lot_id,
    p.requires_cut, p.requires_edge, p.requires_cnc, p.requires_joinery,
    p.manual_joinery, p.route_steps, p.completed_steps, p.is_blocked,
    p.rework_status, p.replacement_status, count(*)::bigint as piece_weight
  from selected_piece_rows p
  group by p.pcp_import_batch_id, p.lot_id, p.requires_cut, p.requires_edge,
    p.requires_cnc, p.requires_joinery, p.manual_joinery, p.route_steps,
    p.completed_steps, p.is_blocked, p.rework_status, p.replacement_status
  union all
  select grouped.* from cached_piece_groups cache
  cross join lateral jsonb_to_recordset(cache.piece_groups) as grouped(
    id uuid,pcp_import_batch_id uuid,lot_id uuid,
    requires_cut boolean,requires_edge boolean,requires_cnc boolean,requires_joinery boolean,
    manual_joinery boolean,route_steps text[],completed_steps text[],is_blocked boolean,
    rework_status text,replacement_status text,piece_weight bigint
  )
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    p.piece_weight,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when $1 is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$query$;
  result jsonb; allowed_lots uuid[]; allowed_orders uuid[]; allowed_recorded uuid[];
BEGIN
  IF NOT public.current_profile_has_global_cell_access() THEN
    allowed_lots:=ARRAY(SELECT public.current_profile_readable_lot_ids());
    allowed_orders:=ARRAY(SELECT public.current_profile_readable_order_ids());
    allowed_recorded:=ARRAY(SELECT public.current_profile_readable_recorded_piece_ids());
    statement:=replace(statement,'/* authorized_piece_lookup */',
      'and (p.lot_id=ANY($3) or p.production_order_id=ANY($4) or p.id=ANY($5))');
  END IF;
  EXECUTE statement INTO result USING p_batch_id,p_limit,allowed_lots,allowed_orders,allowed_recorded;
  RETURN result;
END;
$function$
;

-- Source: 20260926143100_finalized_receipt_lock_avoidance.sql
-- Avoid row-lock queues when an authenticated device retries an already finalized receipt.

DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))<>'99a466c7964bef2a52dfe3090c760f72' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('private.audit_collection_immediate_release_v1()'::regprocedure))<>'4ae85ace26c60dd653536bc802bf30d0' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_AUDIT_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.ingest_collection_batch_immediate_v3(p_batch_id uuid, p_device_id uuid, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pgmq', 'pg_temp'
AS $function$
DECLARE
 actor uuid:=auth.uid();
 worker text:='immediate:backend:'||pg_backend_pid()::text;
 previous_wake text:=coalesce(current_setting('acprod.collection_v3_wake_decision',true),'');
 previous_decision text:=coalesce(current_setting('acprod.collection_v3_decision',true),'');
 previous_lock_timeout text:=current_setting('lock_timeout');
 ingress jsonb;
 items jsonb:='[]'::jsonb;
 claimed jsonb;
 processed jsonb;
 response jsonb;
 row_receipt public.coletas_producao%ROWTYPE;
 claim_time timestamptz;
BEGIN
 IF actor IS NULL OR coalesce(auth.role(),'')<>'authenticated' THEN
  RAISE EXCEPTION 'AUTHENTICATED_OPERATOR_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_events) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_events->'events') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'COLLECTION_BATCH_ENVELOPE_INVALID' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_events->'events')<1 OR jsonb_array_length(p_events->'events')>5 THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_BATCH_LIMIT_5' USING ERRCODE='22023';
 END IF;
 -- A função de ingresso existente valida sessão, captura, máquina, célula,
 -- escopo, dispositivo/sequência e idempotência antes de qualquer decisão.
 PERFORM set_config('acprod.collection_v3_wake_decision','sent',true);
 PERFORM set_config('lock_timeout','500ms',true);
 ingress:=public.ingest_collection_batch_v3(p_batch_id,p_device_id,p_events);
 -- Validate ownership for finalized receipts as well as pending receipts.
 -- A committed retry only reads its stored decision; it must not serialize
 -- every retry behind an exclusive row lock held until response enrichment.
 IF EXISTS (
   SELECT 1 FROM public.coletas_producao r
   JOIN pg_temp.collection_v3_ingress_input input ON input.receipt_id=r.id
   WHERE input.error_code IS NULL AND (
     r.auth_user_id IS DISTINCT FROM actor OR r.device_id IS DISTINCT FROM p_device_id::text
   )
 ) THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_OWNER_INVALID' USING ERRCODE='42501';
 END IF;
 FOR row_receipt IN
  SELECT r.* FROM public.coletas_producao r
  WHERE r.id IN(SELECT input.receipt_id FROM pg_temp.collection_v3_ingress_input input
    WHERE input.error_code IS NULL AND input.receipt_id IS NOT NULL)
    AND r.decision_committed_at IS NULL AND r.dead_lettered_at IS NULL
  ORDER BY r.id FOR UPDATE
 LOOP
  IF row_receipt.auth_user_id IS DISTINCT FROM actor
     OR row_receipt.device_id IS DISTINCT FROM p_device_id::text THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_OWNER_INVALID' USING ERRCODE='42501';
  END IF;
  -- Reenvio de uma decisão já gravada nunca decide novamente nem reconta a peça.
  IF row_receipt.decision_committed_at IS NOT NULL OR row_receipt.dead_lettered_at IS NOT NULL THEN
   CONTINUE;
  END IF;
  IF row_receipt.operator_session_id IS DISTINCT FROM
      private.try_collection_uuid_v3(p_events->>'operator_session_id') THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SESSION_MISMATCH' USING ERRCODE='42501';
  END IF;
  claim_time:=clock_timestamp();
  claimed:=NULL;
  IF row_receipt.queue_name='collection_live_v3' THEN
   UPDATE pgmq.q_collection_live_v3 q
   SET read_ct=q.read_ct+1,vt=claim_time+interval '45 seconds'
   WHERE q.msg_id=row_receipt.queue_message_id AND q.vt<=claim_time
     AND q.message->>'receipt_id'=row_receipt.id::text
     AND q.message->>'client_event_id'=row_receipt.client_event_id
   RETURNING to_jsonb(q)||jsonb_build_object('queue_name','collection_live_v3') INTO claimed;
  ELSIF row_receipt.queue_name='collection_replay_v3' THEN
   UPDATE pgmq.q_collection_replay_v3 q
   SET read_ct=q.read_ct+1,vt=claim_time+interval '45 seconds'
   WHERE q.msg_id=row_receipt.queue_message_id AND q.vt<=claim_time
     AND q.message->>'receipt_id'=row_receipt.id::text
     AND q.message->>'client_event_id'=row_receipt.client_event_id
   RETURNING to_jsonb(q)||jsonb_build_object('queue_name','collection_replay_v3') INTO claimed;
  END IF;
  IF claimed IS NULL THEN
   -- Um worker anterior pode estar tratando este recibo. Não devolve falso ACK final.
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_BUSY' USING ERRCODE='55P03';
  END IF;
  INSERT INTO private.collection_immediate_context_v3
    (backend_pid,transaction_id,auth_user_id,receipt_id)
  VALUES(pg_backend_pid(),pg_current_xact_id(),actor,row_receipt.id);
  UPDATE public.coletas_producao
  SET status_sincronizacao='processando',claimed_at=claim_time,
    lease_expires_at=claim_time+interval '45 seconds',worker_id=worker,
    attempt_count=greatest(attempt_count,(claimed->>'read_ct')::integer),
    queue_delay_ms=extract(epoch FROM claim_time-coalesce(enqueued_at,received_at_db))*1000,
    updated_at=claim_time
  WHERE id=row_receipt.id;
  INSERT INTO public.collection_processing_attempts(
    client_event_id,attempt_number,worker_id,queue_name,claimed_at,queue_delay_ms)
  VALUES(row_receipt.client_event_id,(claimed->>'read_ct')::integer,worker,row_receipt.queue_name,
    claim_time,extract(epoch FROM claim_time-coalesce(row_receipt.enqueued_at,row_receipt.received_at_db))*1000)
  ON CONFLICT(client_event_id,attempt_number) DO NOTHING;
  items:=items||jsonb_build_array(claimed||jsonb_build_object('input_ordinal',
    (SELECT min(input.ordinal) FROM pg_temp.collection_v3_ingress_input input
      WHERE input.receipt_id=row_receipt.id AND input.error_code IS NULL)));
 END LOOP;
 IF jsonb_array_length(items)>0 THEN
  SELECT jsonb_agg(input.value ORDER BY (input.value->>'input_ordinal')::integer)
    INTO items FROM jsonb_array_elements(items) input(value);
  INSERT INTO private.collection_worker_heartbeats(worker_id,worker_kind,started_at,heartbeat_at,claimed_count)
  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items))
  ON CONFLICT(worker_id) DO UPDATE SET
    worker_kind=excluded.worker_kind,
    invocation_id=NULL,
    started_at=excluded.started_at,
    heartbeat_at=excluded.heartbeat_at,
    finished_at=NULL,
    claimed_count=excluded.claimed_count,
    finalized_count=0,
    last_error_code=NULL;
  PERFORM set_config('acprod.collection_v3_decision','on',true);
  processed:=private.process_collection_batch_v3(worker,items);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(processed) x(value)
    WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review')) THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_NOT_COMMITTED' USING ERRCODE='40001',
    DETAIL=(SELECT jsonb_build_object('decision_error_codes',jsonb_agg(
      CASE WHEN coalesce(x.value->>'reason_code','') ~ '^[A-Z0-9_]{1,64}$'
        THEN x.value->>'reason_code' ELSE 'UNCLASSIFIED' END))::text
      FROM jsonb_array_elements(processed) x(value)
      WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review'));
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.collection_v3_ingress_input input
   JOIN public.coletas_producao r ON r.id=input.receipt_id
   WHERE input.error_code IS NULL AND r.decision_committed_at IS NULL AND r.dead_lettered_at IS NULL) THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_MISSING' USING ERRCODE='40001';
 END IF;
 -- Metadados vêm da decisão e da identidade da peça, não de uma projeção futura.
 WITH enriched AS (
  SELECT input.ordinal,input.client_event_id,input.error_code,input.inserted,
    r.received_at_db,r.decision_committed_at,r.projected_at,r.dead_lettered_at,
    r.id AS receipt_id,
    coalesce(r.resultado,'{}'::jsonb)
    ||CASE WHEN r.dead_lettered_at IS NOT NULL AND r.decision_committed_at IS NULL
      THEN jsonb_build_object('success',false,'decision','dead_lettered','status','dead_lettered',
        'reason_code',coalesce(r.final_reason_code,'COLLECTION_DEAD_LETTERED'),
        'message','A leitura anterior terminou com erro e precisa de revisão.')
      ELSE '{}'::jsonb END
    ||jsonb_strip_nulls(jsonb_build_object(
      'piece',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'piece_uid',p.piece_uid,
        'traceability_code',p.traceability_code,'piece_name',p.piece_name,'current_stage',p.current_stage,
        'route_steps',p.route_steps,'completed_steps',p.completed_steps) END,
      'item',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'piece_uid',p.piece_uid,
        'traceability_code',p.traceability_code,'piece_name',p.piece_name,'current_stage',p.current_stage,
        'route_steps',p.route_steps,'completed_steps',p.completed_steps) END,
      'lot',CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id',l.id,'lot_code',l.lot_code,
        'pcp_import_batch_id',p.pcp_import_batch_id,'general_lot_code',b.general_lot_code) END,
      'piece_id',p.id,'lot_id',l.id,'lot_code',l.lot_code,'pcp_import_batch_id',p.pcp_import_batch_id,
      'general_lot_code',b.general_lot_code,'customer_name',o.customer_name,
      'cell_id',r.cell_id,'cell_name',c.name,'machine_id',r.machine_id,
      'committed_at',r.decision_committed_at,'decision_committed_at',r.decision_committed_at
    )) AS final_result
  FROM pg_temp.collection_v3_ingress_input input
  LEFT JOIN public.coletas_producao r ON r.id=input.receipt_id AND input.error_code IS NULL
  LEFT JOIN public.production_pieces p ON p.id=private.try_collection_uuid_v3(r.resultado->>'piece_id')
  LEFT JOIN public.production_lots l ON l.id=p.lot_id
  LEFT JOIN public.promob_import_batches b ON b.id=p.pcp_import_batch_id
  LEFT JOIN public.production_orders o ON o.id=coalesce(p.production_order_id,l.production_order_id,l.order_id)
  LEFT JOIN public.cells c ON c.id=r.cell_id
 )
 SELECT jsonb_agg(jsonb_build_object(
   'client_event_id',e.client_event_id,'persisted',e.receipt_id IS NOT NULL AND e.error_code IS NULL,
   'duplicate_receipt',e.receipt_id IS NOT NULL AND NOT e.inserted,
   'received_at_db',e.received_at_db,'error_code',e.error_code,
   'decision',e.final_result->>'decision','status',e.final_result->>'status',
   'collection_state',upper(coalesce(e.final_result->>'decision',e.final_result->>'status')),
   'status_sincronizacao',CASE WHEN e.decision_committed_at IS NOT NULL THEN 'sincronizada' ELSE 'erro' END,
   'committed_at',e.decision_committed_at,'decision_committed_at',e.decision_committed_at,
   'queue_status',CASE WHEN e.dead_lettered_at IS NOT NULL THEN 'dead_lettered'
     WHEN e.error_code IS NOT NULL THEN 'rejected' ELSE 'decided' END,
   'projection_status',CASE WHEN e.projected_at IS NOT NULL THEN 'projected' ELSE 'pending' END,
   'projected_at',e.projected_at,'transport_phase','finalized','result',e.final_result
 ) ORDER BY e.ordinal) INTO response FROM enriched e;
 DELETE FROM private.collection_immediate_context_v3
 WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id() AND auth_user_id=actor;
 PERFORM set_config('acprod.collection_v3_wake_decision',previous_wake,true);
 PERFORM set_config('acprod.collection_v3_decision',previous_decision,true);
 PERFORM set_config('lock_timeout',previous_lock_timeout,true);
 RETURN jsonb_build_object('batch_id',p_batch_id,'device_id',p_device_id,
   'received_at_db',ingress->'received_at_db','confirmation_mode','immediate_decision',
   'results',coalesce(response,'[]'::jsonb));
EXCEPTION WHEN OTHERS OR query_canceled THEN
 PERFORM set_config('acprod.collection_v3_wake_decision',previous_wake,true);
 PERFORM set_config('acprod.collection_v3_decision',previous_decision,true);
 PERFORM set_config('lock_timeout',previous_lock_timeout,true);
 RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION private.audit_collection_immediate_release_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT public.get_public_collection_runtime_health() AS value
  ),
  objects AS (
    SELECT
      to_regprocedure(
        'public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'
      ) AS immediate_rpc,
      to_regprocedure(
        'private.collection_immediate_context_active_v3()'
      ) AS immediate_context_function,
      to_regclass(
        'private.collection_immediate_context_v3'
      ) AS immediate_context_table
  ),
  definitions AS (
    SELECT coalesce(regexp_replace(
      lower(pg_get_functiondef(objects.immediate_rpc)),
      '[[:space:]]+',
      '',
      'g'
    ), '') AS immediate_rpc
    FROM objects
  ),
  rollout AS (
    SELECT
      coalesce(flag.enabled, false) AS enabled,
      coalesce(flag.rollout_scope, '{}'::jsonb) AS scope
    FROM (SELECT 1) AS seed
    LEFT JOIN private.collection_pipeline_flags flag
      ON flag.flag_name = 'collection_pipeline_v3_ingress'
  ),
  immediate_flags AS (
    SELECT jsonb_build_object(
      'collection_immediate_rpc_exists',
        objects.immediate_rpc IS NOT NULL,
      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = 'aa4f5381ab5b7514c8d816b48af8f41e',
      'collection_immediate_rpc_owner',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        ),
      'collection_immediate_rpc_security',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        )
        AND coalesce(
          has_function_privilege('authenticated', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('service_role', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_proc function_row,
               aclexplode(coalesce(
                 function_row.proacl,
                 acldefault('f', function_row.proowner)
               )) privilege
          WHERE function_row.oid = objects.immediate_rpc
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ),
      'collection_immediate_context_private',
        objects.immediate_context_table IS NOT NULL
        AND objects.immediate_context_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_class table_row
          WHERE table_row.oid = objects.immediate_context_table
            AND table_row.relrowsecurity IS TRUE
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('authenticated', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('service_role', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'anon', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'service_role', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        ),
      'collection_immediate_batch_limit_5',
        position('collection_immediate_batch_limit_5' IN definitions.immediate_rpc) > 0
        AND position('jsonb_array_length(p_events->''events'')>5' IN definitions.immediate_rpc) > 0,
      'collection_immediate_decision_committed',
        position('private.process_collection_batch_v3' IN definitions.immediate_rpc) > 0
        AND position('collection_immediate_decision_missing' IN definitions.immediate_rpc) > 0
        AND position('decision_committed_at' IN definitions.immediate_rpc) > 0,
      'collection_immediate_projection_async',
        position('private.process_collection_projection_batch_v3' IN definitions.immediate_rpc) = 0,
      'collection_immediate_rollout_all',
        rollout.enabled IS TRUE
        AND rollout.scope ->> 'immediate_rpc' = 'ingest_collection_batch_immediate_v3'
        AND coalesce((rollout.scope ->> 'immediate_max_events')::integer, 0) = 5
        AND coalesce((rollout.scope ->> 'all')::boolean, false) IS TRUE
    ) AS value
    FROM objects, definitions, rollout
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.value ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM immediate_flags, jsonb_each_text(immediate_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', '20260908154004',
    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'gate_migration_version', '20260913043419',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1_1',
    'transport', 'immediate_v3',
    'ingress_rpc', 'ingest_collection_batch_immediate_v3',
    'max_events_per_request', 5,
    'projection', 'async_v3_outbox',
    'schema_flags', immediate_flags.value
  )
  FROM base, immediate_flags;
$function$;
UPDATE private.collection_immediate_release_snapshot_v1
SET expected_audit_function_hash='7c929162aca03ce0c34c1ab59d45483d'
WHERE singleton AND expected_audit_function_hash='4ae85ace26c60dd653536bc802bf30d0';
DO $verified$ BEGIN
IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))<>'aa4f5381ab5b7514c8d816b48af8f41e' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_TARGET_MISMATCH'; END IF;
END; $verified$;
SELECT private.refresh_collection_immediate_release_snapshot_v1();

NOTIFY pgrst, 'reload schema';
COMMIT;

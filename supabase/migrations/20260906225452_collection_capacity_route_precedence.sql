-- Explicit routes are authoritative over legacy requires flags. Changes only
-- derived route counts; no piece, reading, session or authorization writes.
SET lock_timeout = '3s';

DO $route_precedence$
DECLARE
  v_signature text;
  v_definition text;
  v_old_required text := $old$
    case stage.stage_code
      when 'cut' then coalesce(piece.requires_cut, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'edge' then coalesce(piece.requires_edge, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'drill' then stage.stage_code = any(piece.canonical_route_steps)
      when 'cnc' then coalesce(piece.requires_cnc, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'joinery' then coalesce(piece.requires_joinery, false)
        or coalesce(piece.manual_joinery, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'separation' then coalesce(piece.requires_separation, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'packaging' then coalesce(piece.requires_packaging, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      else false
    end as is_required,$old$;
  v_new_required text := $new$
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.canonical_route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,$new$;
BEGIN
  -- Both bodies embed the same canonical query: the public fallback executes
  -- under its caller's RLS; the private original feeds the worker-only cache.
  FOREACH v_signature IN ARRAY ARRAY[
    'private.get_lot_route_stage_progress_uncached_capacity(uuid)',
    'public.get_lot_route_stage_progress(uuid)'
  ] LOOP
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    IF position('collection_route_precedence_v1' IN v_definition)>0 THEN CONTINUE; END IF;
    IF position(v_old_required IN v_definition)=0
       OR position('    root.manual_joinery,' IN v_definition)=0
       OR (SELECT procedure.prosecdef FROM pg_proc procedure WHERE procedure.oid=v_signature::regprocedure) THEN
      RAISE EXCEPTION 'COLLECTION_ROUTE_PRECEDENCE_QUERY_SHAPE_CHANGED: %',v_signature;
    END IF;
    v_definition:=replace(v_definition,'    root.manual_joinery,',
      E'    root.manual_joinery,\n    cardinality(coalesce(root.route_steps, ''{}''::text[])) > 0 as has_explicit_route,');
    v_definition:=replace(v_definition,v_old_required,v_new_required);
    EXECUTE v_definition;
  END LOOP;

  -- A deployment may become visible between two statements of a worker
  -- transaction. Clear only its OWN temporary memoization once for this rule
  -- version; never reuse a previous rule's result for another batch refresh.
  v_definition:=pg_get_functiondef('private.get_lot_route_stage_progress_cached_capacity(uuid)'::regprocedure);
  IF position('collection_route_precedence_v1' IN v_definition)=0 THEN
    IF position('  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache' IN v_definition)=0 THEN
      RAISE EXCEPTION 'COLLECTION_ROUTE_PRECEDENCE_TEMP_CACHE_SHAPE_CHANGED';
    END IF;
    v_definition:=replace(v_definition,
      '  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache',
      E'  IF coalesce(current_setting(''acprod.collection_route_precedence_v1'',true),'''') <> ''on'' THEN\n    DELETE FROM pg_temp.collection_v3_route_progress_cache WHERE batch_id IS NOT NULL;\n    PERFORM set_config(''acprod.collection_route_precedence_v1'',''on'',true);\n  END IF;\n  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache');
    EXECUTE v_definition;
  END IF;
END;
$route_precedence$;

-- Only derived caches are invalidated. -infinity cannot match a real import
-- revision (including NULL), so the scoped RPC falls back until safely warmed.
UPDATE private.collection_dashboard_batch_snapshots
SET source_batch_updated_at='-infinity'::timestamptz
WHERE source_batch_updated_at IS DISTINCT FROM '-infinity'::timestamptz;

NOTIFY pgrst,'reload schema';

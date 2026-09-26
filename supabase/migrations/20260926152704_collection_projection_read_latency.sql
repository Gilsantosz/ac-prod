BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- Preserve canonical route, replacement and manual allocation semantics while reducing repeated work.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.get_lot_route_stage_progress(uuid)'::regprocedure)) <> '050acefcd3dd75095003bcc517500216' THEN RAISE EXCEPTION 'GROUPED_PROJECTOR_SOURCE_MISMATCH: public.get_lot_route_stage_progress(uuid)'; END IF;
IF md5(pg_get_functiondef('private.get_lot_route_stage_progress_uncached_capacity(uuid)'::regprocedure)) <> '5a88dd00d4cdf20d82eafee91b2300aa' THEN RAISE EXCEPTION 'GROUPED_PROJECTOR_SOURCE_MISMATCH: private.get_lot_route_stage_progress_uncached_capacity(uuid)'; END IF;
IF md5(pg_get_functiondef('public.refresh_pcp_batch_progress(uuid)'::regprocedure)) <> '4683d03293f896b8d8a744de2bf30b0c' THEN RAISE EXCEPTION 'GROUPED_PROJECTOR_SOURCE_MISMATCH: public.refresh_pcp_batch_progress(uuid)'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.get_lot_route_stage_progress(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
      DECLARE v_result jsonb;
      BEGIN
        IF coalesce(auth.role(), '') = 'service_role'
           AND current_setting('acprod.collection_v3_projection_cache', true) = 'on' THEN
          -- Dynamic resolution keeps private-schema privileges out of normal
          -- API calls; no SECURITY DEFINER/RLS bypass is introduced.
          EXECUTE 'SELECT private.get_lot_route_stage_progress_cached_capacity($1)'
            INTO v_result USING p_batch_id;
          RETURN v_result;
        END IF;
        RETURN (
with
stage_catalog(stage_code, stage_label, stage_order) as (
  values
    ('cut'::text, 'Corte'::text, 1),
    ('edge'::text, 'Borda'::text, 2),
    ('drill'::text, 'Furação'::text, 3),
    ('cnc'::text, 'Usinagem CNC'::text, 4),
    ('joinery'::text, 'Marcenaria'::text, 5),
    ('separation'::text, 'Separação'::text, 6),
    ('packaging'::text, 'Embalagem'::text, 7)
),
scoped_pieces as materialized (
  select
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    root.requires_cut,
    root.requires_edge,
    root.requires_cnc,
    root.requires_joinery,
    root.requires_separation,
    root.requires_packaging,
    root.manual_joinery,
    cardinality(coalesce(root.route_steps, '{}'::text[])) > 0 as has_explicit_route,
    accounting.replacement_pending,
    root.route_steps as raw_route_steps,
    effective.completed_steps as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join public.production_pieces effective on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
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
-- Equal route/completion states contribute equal stage decisions. Evaluate
-- those decisions once per lot/state, retaining their exact multiplicity.
piece_groups as materialized (
  select lot_id, has_explicit_route, route_steps, completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending,
    count(*)::bigint as piece_count
  from pieces
  group by lot_id, has_explicit_route, route_steps, completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending
),
piece_stage as (
  select
    piece.lot_id,
    piece.piece_count,
    stage.stage_code,
    stage.stage_label,
    stage.stage_order,
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,
    stage.stage_code = any(piece.completed_steps) as is_completed,
    piece.replacement_pending
  from piece_groups piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order,
    coalesce(sum(progress.piece_count) filter (where progress.is_required),0)::integer as required_pieces,
    coalesce(sum(progress.piece_count) filter (where progress.is_required and progress.is_completed),0)::integer as traceable_completed_pieces,
    coalesce(sum(progress.piece_count) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    ),0)::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order
),
batch_stage as (
  select
    progress.stage_code, progress.stage_label, progress.stage_order,
    coalesce(sum(progress.piece_count) filter (where progress.is_required),0)::integer as required_pieces,
    coalesce(sum(progress.piece_count) filter (where progress.is_required and progress.is_completed),0)::integer as traceable_completed_pieces,
    coalesce(sum(progress.piece_count) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    ),0)::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.stage_code, progress.stage_label, progress.stage_order
),
manual_stage as (
  select record.stage_code,
         coalesce(sum(record.quantity), 0)::integer as recorded_manual_quantity,
         count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
),
lot_remaining as (
  select stage.*, lot.created_at as lot_created_at,
         greatest(stage.required_pieces - stage.replacement_pending_pieces - stage.traceable_completed_pieces, 0)::integer as traceable_remaining,
         coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage stage
  left join public.production_lots lot on lot.id = stage.lot_id
  left join manual_stage manual on manual.stage_code = stage.stage_code
),
lot_allocated as (
  select remaining.*,
         greatest(least(
           remaining.traceable_remaining,
           remaining.batch_manual_quantity - coalesce(sum(remaining.traceable_remaining) over (
             partition by remaining.stage_code
             order by remaining.lot_created_at nulls last, remaining.lot_id
             rows between unbounded preceding and 1 preceding
           ), 0)
         ), 0)::integer as manual_quantity
  from lot_remaining remaining
),
lot_effective as (
  select allocated.*,
         least(allocated.required_pieces - allocated.replacement_pending_pieces,
               allocated.traceable_completed_pieces + allocated.manual_quantity)::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select batch.*,
         coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
         least(greatest(batch.required_pieces - batch.replacement_pending_pieces - batch.traceable_completed_pieces, 0),
               coalesce(manual.recorded_manual_quantity, 0))::integer as manual_quantity,
         coalesce(manual.manual_entry_count, 0)::integer as manual_entry_count
  from batch_stage batch
  left join manual_stage manual on manual.stage_code = batch.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_completed', not exists (
    select 1 from batch_effective stage
    where stage.required_pieces > 0
      and (stage.replacement_pending_pieces > 0
        or stage.traceable_completed_pieces + stage.manual_quantity < stage.required_pieces)
  ),
  'batch_stages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'stage_code', batch.stage_code,
      'stage_label', batch.stage_label,
      'stage_order', batch.stage_order,
      'required_pieces', batch.required_pieces,
      'traceable_completed_pieces', batch.traceable_completed_pieces,
      'replacement_pending_pieces', batch.replacement_pending_pieces,
      'manual_quantity', batch.manual_quantity,
      'recorded_manual_quantity', batch.recorded_manual_quantity,
      'completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                batch.traceable_completed_pieces + batch.manual_quantity),
      'effective_completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                          batch.traceable_completed_pieces + batch.manual_quantity),
      'remaining_pieces', greatest(batch.required_pieces - batch.traceable_completed_pieces - batch.manual_quantity, 0),
      'progress_percent', case when batch.required_pieces > 0 then round((
        100.0 * least(batch.required_pieces - batch.replacement_pending_pieces,
                      batch.traceable_completed_pieces + batch.manual_quantity) / batch.required_pieces
      )::numeric, 2) else 100.0::numeric end,
      'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
      'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
      'manual_entry_count', batch.manual_entry_count
    ) order by batch.stage_order)
    from batch_effective batch
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
  ), '[]'::jsonb),
  'lot_stages', coalesce((
    select jsonb_object_agg(lot.lot_id::text, lot.stages)
    from (
      select stage.lot_id,
             jsonb_agg(jsonb_build_object(
               'stage_code', stage.stage_code,
               'stage_label', stage.stage_label,
               'stage_order', stage.stage_order,
               'required_pieces', stage.required_pieces,
               'traceable_completed_pieces', stage.traceable_completed_pieces,
               'replacement_pending_pieces', stage.replacement_pending_pieces,
               'manual_quantity', stage.manual_quantity,
               'completed_pieces', stage.effective_completed_pieces,
               'effective_completed_pieces', stage.effective_completed_pieces,
               'remaining_pieces', greatest(stage.required_pieces - stage.effective_completed_pieces, 0),
               'progress_percent', case when stage.required_pieces > 0
                 then round((100.0 * stage.effective_completed_pieces / stage.required_pieces)::numeric, 2)
                 else 100.0::numeric end,
               'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
               'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false)
             ) order by stage.stage_order) as stages
      from lot_effective stage
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
));
      END;
      $function$;
CREATE OR REPLACE FUNCTION private.get_lot_route_stage_progress_uncached_capacity(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order) as (
  values
    ('cut'::text, 'Corte'::text, 1),
    ('edge'::text, 'Borda'::text, 2),
    ('drill'::text, 'Furação'::text, 3),
    ('cnc'::text, 'Usinagem CNC'::text, 4),
    ('joinery'::text, 'Marcenaria'::text, 5),
    ('separation'::text, 'Separação'::text, 6),
    ('packaging'::text, 'Embalagem'::text, 7)
),
scoped_pieces as materialized (
  select
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    root.requires_cut,
    root.requires_edge,
    root.requires_cnc,
    root.requires_joinery,
    root.requires_separation,
    root.requires_packaging,
    root.manual_joinery,
    cardinality(coalesce(root.route_steps, '{}'::text[])) > 0 as has_explicit_route,
    accounting.replacement_pending,
    root.route_steps as raw_route_steps,
    effective.completed_steps as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join public.production_pieces effective on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
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
-- Equal route/completion states contribute equal stage decisions. Evaluate
-- those decisions once per lot/state, retaining their exact multiplicity.
piece_groups as materialized (
  select lot_id, has_explicit_route, route_steps, completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending,
    count(*)::bigint as piece_count
  from pieces
  group by lot_id, has_explicit_route, route_steps, completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending
),
piece_stage as (
  select
    piece.lot_id,
    piece.piece_count,
    stage.stage_code,
    stage.stage_label,
    stage.stage_order,
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,
    stage.stage_code = any(piece.completed_steps) as is_completed,
    piece.replacement_pending
  from piece_groups piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order,
    coalesce(sum(progress.piece_count) filter (where progress.is_required),0)::integer as required_pieces,
    coalesce(sum(progress.piece_count) filter (where progress.is_required and progress.is_completed),0)::integer as traceable_completed_pieces,
    coalesce(sum(progress.piece_count) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    ),0)::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order
),
batch_stage as (
  select
    progress.stage_code, progress.stage_label, progress.stage_order,
    coalesce(sum(progress.piece_count) filter (where progress.is_required),0)::integer as required_pieces,
    coalesce(sum(progress.piece_count) filter (where progress.is_required and progress.is_completed),0)::integer as traceable_completed_pieces,
    coalesce(sum(progress.piece_count) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    ),0)::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.stage_code, progress.stage_label, progress.stage_order
),
manual_stage as (
  select record.stage_code,
         coalesce(sum(record.quantity), 0)::integer as recorded_manual_quantity,
         count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
),
lot_remaining as (
  select stage.*, lot.created_at as lot_created_at,
         greatest(stage.required_pieces - stage.replacement_pending_pieces - stage.traceable_completed_pieces, 0)::integer as traceable_remaining,
         coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage stage
  left join public.production_lots lot on lot.id = stage.lot_id
  left join manual_stage manual on manual.stage_code = stage.stage_code
),
lot_allocated as (
  select remaining.*,
         greatest(least(
           remaining.traceable_remaining,
           remaining.batch_manual_quantity - coalesce(sum(remaining.traceable_remaining) over (
             partition by remaining.stage_code
             order by remaining.lot_created_at nulls last, remaining.lot_id
             rows between unbounded preceding and 1 preceding
           ), 0)
         ), 0)::integer as manual_quantity
  from lot_remaining remaining
),
lot_effective as (
  select allocated.*,
         least(allocated.required_pieces - allocated.replacement_pending_pieces,
               allocated.traceable_completed_pieces + allocated.manual_quantity)::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select batch.*,
         coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
         least(greatest(batch.required_pieces - batch.replacement_pending_pieces - batch.traceable_completed_pieces, 0),
               coalesce(manual.recorded_manual_quantity, 0))::integer as manual_quantity,
         coalesce(manual.manual_entry_count, 0)::integer as manual_entry_count
  from batch_stage batch
  left join manual_stage manual on manual.stage_code = batch.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_completed', not exists (
    select 1 from batch_effective stage
    where stage.required_pieces > 0
      and (stage.replacement_pending_pieces > 0
        or stage.traceable_completed_pieces + stage.manual_quantity < stage.required_pieces)
  ),
  'batch_stages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'stage_code', batch.stage_code,
      'stage_label', batch.stage_label,
      'stage_order', batch.stage_order,
      'required_pieces', batch.required_pieces,
      'traceable_completed_pieces', batch.traceable_completed_pieces,
      'replacement_pending_pieces', batch.replacement_pending_pieces,
      'manual_quantity', batch.manual_quantity,
      'recorded_manual_quantity', batch.recorded_manual_quantity,
      'completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                batch.traceable_completed_pieces + batch.manual_quantity),
      'effective_completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                          batch.traceable_completed_pieces + batch.manual_quantity),
      'remaining_pieces', greatest(batch.required_pieces - batch.traceable_completed_pieces - batch.manual_quantity, 0),
      'progress_percent', case when batch.required_pieces > 0 then round((
        100.0 * least(batch.required_pieces - batch.replacement_pending_pieces,
                      batch.traceable_completed_pieces + batch.manual_quantity) / batch.required_pieces
      )::numeric, 2) else 100.0::numeric end,
      'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
      'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
      'manual_entry_count', batch.manual_entry_count
    ) order by batch.stage_order)
    from batch_effective batch
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
  ), '[]'::jsonb),
  'lot_stages', coalesce((
    select jsonb_object_agg(lot.lot_id::text, lot.stages)
    from (
      select stage.lot_id,
             jsonb_agg(jsonb_build_object(
               'stage_code', stage.stage_code,
               'stage_label', stage.stage_label,
               'stage_order', stage.stage_order,
               'required_pieces', stage.required_pieces,
               'traceable_completed_pieces', stage.traceable_completed_pieces,
               'replacement_pending_pieces', stage.replacement_pending_pieces,
               'manual_quantity', stage.manual_quantity,
               'completed_pieces', stage.effective_completed_pieces,
               'effective_completed_pieces', stage.effective_completed_pieces,
               'remaining_pieces', greatest(stage.required_pieces - stage.effective_completed_pieces, 0),
               'progress_percent', case when stage.required_pieces > 0
                 then round((100.0 * stage.effective_completed_pieces / stage.required_pieces)::numeric, 2)
                 else 100.0::numeric end,
               'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
               'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false)
             ) order by stage.stage_order) as stages
      from lot_effective stage
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
);
$function$;
CREATE OR REPLACE FUNCTION public.refresh_pcp_batch_progress(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_progress jsonb;
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_total_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_progress_percent numeric := 0;
  v_batch_completed boolean := false;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_progress := public.get_lot_route_stage_progress(p_batch_id);
  v_batch_completed := coalesce((v_progress ->> 'batch_completed')::boolean, false);

  SELECT
    coalesce(sum((stage.value ->> 'required_pieces')::bigint), 0),
    coalesce(sum((stage.value ->> 'effective_completed_pieces')::bigint), 0)
  INTO v_total_operations, v_completed_operations
  FROM jsonb_array_elements(coalesce(v_progress -> 'batch_stages', '[]'::jsonb)) stage(value);

  WITH lot_roots AS (
    SELECT root.lot_id, count(*)::bigint AS root_count
    FROM public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
    JOIN public.production_pieces root
      ON root.id = accounting.root_piece_id
    WHERE root.pcp_import_batch_id = p_batch_id
      AND lower(coalesce(root.status, '')) NOT IN ('cancelled','canceled')
    GROUP BY root.lot_id
  ),
  lot_completion AS (
    SELECT
      lot_root.lot_id,
      lot_root.root_count,
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          coalesce(v_progress -> 'lot_stages' -> lot_root.lot_id::text, '[]'::jsonb)
        ) stage(value)
        WHERE coalesce((stage.value ->> 'required_pieces')::integer, 0) > 0
          AND (
            coalesce((stage.value ->> 'remaining_pieces')::integer, 0) > 0
            OR coalesce((stage.value ->> 'replacement_pending_pieces')::integer, 0) > 0
          )
      ) AS is_complete
    FROM lot_roots lot_root
  )
  SELECT coalesce(sum(root_count), 0)::bigint,
    coalesce(sum(root_count) FILTER (WHERE is_complete), 0)::bigint
  INTO v_total_parts, v_completed_parts
  FROM lot_completion;

  IF v_batch_completed THEN
    v_completed_parts := v_total_parts;
  END IF;

  v_progress_percent := CASE
    WHEN v_total_operations > 0
      THEN round((100.0 * v_completed_operations / v_total_operations)::numeric, 2)
    WHEN v_total_parts > 0
      THEN round((100.0 * v_completed_parts / v_total_parts)::numeric, 2)
    ELSE 0
  END;

  UPDATE public.promob_import_batches batch
  SET total_parts = v_total_parts,
      completed_parts = least(v_completed_parts, v_total_parts),
      pending_parts = greatest(v_total_parts - v_completed_parts, 0),
      total_operations = v_total_operations,
      completed_operations = least(v_completed_operations, v_total_operations),
      progress_percent = least(greatest(v_progress_percent, 0), 100)
  WHERE batch.id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_completed', v_batch_completed,
    'total_parts', v_total_parts,
    'completed_parts', least(v_completed_parts, v_total_parts),
    'pending_parts', greatest(v_total_parts - v_completed_parts, 0),
    'total_operations', v_total_operations,
    'completed_operations', least(v_completed_operations, v_total_operations),
    'progress_percent', least(greatest(v_progress_percent, 0), 100),
    'route_progress', v_progress
  );
END;
$function$;

-- Skip recursive replacement lookups for ordinary roots, preserving the exact exceptional-chain algorithm and invoker permissions.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.production_piece_accounting_for_scope(uuid,uuid)'::regprocedure))<>'2139a6e2e99edacc9e06ba279b7b31fb' THEN RAISE EXCEPTION 'SPARSE_ACCOUNTING_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.production_piece_accounting_for_scope(p_batch_id uuid, p_lot_id uuid)
 RETURNS TABLE(root_piece_id uuid, leaf_piece_id uuid, effective_piece_id uuid, open_replacement_id uuid, open_replacement_status text, replacement_pending boolean, replacement_depth integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$ WITH RECURSIVE roots AS MATERIALIZED (
  SELECT piece.id FROM public.production_pieces piece
  WHERE COALESCE(piece.is_replacement,false) IS FALSE
    AND (p_batch_id IS NULL OR piece.pcp_import_batch_id=p_batch_id)
    AND (p_lot_id IS NULL OR piece.lot_id=p_lot_id)
), roots_with_orders AS MATERIALIZED (
  -- Only exceptional roots need chain traversal. The EXISTS observes the
  -- same invoker/RLS snapshot as every subsequent replacement lookup.
  SELECT root.id FROM roots root WHERE EXISTS (
    SELECT 1 FROM public.replacement_orders replacement
    WHERE replacement.original_piece_id=root.id
  )
), replacement_chain AS (
         SELECT piece.id AS root_piece_id,
            piece.id AS leaf_piece_id,
            NULL::text AS incoming_order_status,
            ARRAY[piece.id] AS visited_piece_ids,
            0 AS replacement_depth
           FROM roots_with_orders piece
        UNION ALL
         SELECT chain.root_piece_id,
            next_order.replacement_piece_id,
            next_order.status,
            chain.visited_piece_ids || next_order.replacement_piece_id,
            chain.replacement_depth + 1
           FROM replacement_chain chain
             JOIN LATERAL ( SELECT replacement.replacement_piece_id,
                    replacement.status
                   FROM replacement_orders replacement
                  WHERE replacement.original_piece_id = chain.leaf_piece_id AND replacement.status <> 'cancelled'::text AND replacement.replacement_piece_id IS NOT NULL
                  ORDER BY (COALESCE(replacement.updated_at, replacement.created_at)) DESC, replacement.id DESC
                 LIMIT 1) next_order ON true
          WHERE chain.replacement_depth < 16 AND NOT (next_order.replacement_piece_id = ANY (chain.visited_piece_ids))
        ), latest_leaf AS (
         SELECT DISTINCT ON (chain.root_piece_id) chain.root_piece_id,
            chain.leaf_piece_id,
            chain.incoming_order_status,
            chain.replacement_depth
           FROM replacement_chain chain
          ORDER BY chain.root_piece_id, chain.replacement_depth DESC
        ), resolved AS (
         SELECT leaf.root_piece_id,
            leaf.leaf_piece_id,
            leaf.incoming_order_status,
            leaf.replacement_depth,
            pending_order.id AS pending_order_id,
            pending_order.status AS pending_order_status
           FROM latest_leaf leaf
             LEFT JOIN LATERAL ( SELECT replacement.id,
                    replacement.status
                   FROM replacement_orders replacement
                  WHERE replacement.original_piece_id = leaf.leaf_piece_id AND (replacement.status = ANY (ARRAY['requested'::text, 'under_review'::text, 'approved'::text, 'released'::text, 'in_production'::text])) AND replacement.replacement_piece_id IS NULL
                  ORDER BY replacement.created_at DESC, replacement.id DESC
                 LIMIT 1) pending_order ON true
        )
 SELECT root_piece_id,
    leaf_piece_id,
        CASE
            WHEN pending_order_id IS NULL THEN leaf_piece_id
            ELSE NULL::uuid
        END AS effective_piece_id,
    pending_order_id AS open_replacement_id,
    COALESCE(pending_order_status, incoming_order_status) AS open_replacement_status,
    pending_order_id IS NOT NULL OR COALESCE(incoming_order_status, 'completed'::text) <> 'completed'::text AS replacement_pending,
    replacement_depth
   FROM resolved
UNION ALL
SELECT root.id,root.id,root.id,NULL::uuid,NULL::text,false,0
FROM roots root WHERE NOT EXISTS (
  SELECT 1 FROM roots_with_orders exceptional WHERE exceptional.id=root.id
);$function$;

-- Scope checks repeatedly join readings/events by physical cell and then read
-- their lot/order identifiers. Cover those identifiers to avoid broad heap
-- scans during a synchronized refresh of many screens. No policy is changed.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE INDEX idx_stage_readings_authorized_cell_lot_piece
  ON public.production_stage_readings(cell_name,lot_id,piece_id);
CREATE INDEX idx_collection_events_authorized_cell_lot
  ON public.production_collection_events(cell_name,lot_id);
CREATE INDEX idx_production_entries_authorized_cell_order
  ON public.production_entries(cell,production_order_id);

-- Bind authorized cell names; retain every original authorization branch and security setting.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.current_profile_readable_lot_ids()'::regprocedure))<>'b2b82048b622b79ac3d9c6f96a8bc999' THEN RAISE EXCEPTION 'BOUND_AUTHORIZATION_SOURCE_MISMATCH'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.current_profile_readable_lot_ids()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE allowed_cells text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN; END IF;
  IF public.current_profile_has_global_cell_access() THEN
    RETURN QUERY SELECT id FROM public.production_lots;
    RETURN;
  END IF;
  allowed_cells := ARRAY(SELECT private.current_profile_authorized_cells());
  -- Bind the real scope so the planner can choose indexed lookups for one
  -- physical cell instead of a generic plan that scans every station.
  RETURN QUERY EXECUTE $scope$
    WITH allowed AS MATERIALIZED (SELECT unnest($1::text[]) AS name),
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
    SELECT lot.id FROM public.production_lots lot JOIN accessible ON accessible.id=lot.id
  $scope$ USING allowed_cells;
END;
$function$
;

-- Evaluate exact cell authorization once instead of once for every historical cell name.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.current_profile_readable_recorded_piece_ids()'::regprocedure))<>'8926db4877ff3f7271d47e9cd1a63c1d' THEN RAISE EXCEPTION 'RECORDED_SCOPE_SOURCE_MISMATCH'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.current_profile_readable_recorded_piece_ids()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE allowed_cells text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN; END IF;
  -- profile_can_access_cell rejects NULL active as well as false. Preserve
  -- that rule even though the separate global-access helper allows NULL.
  IF public.current_profile_has_global_cell_access() AND EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id=(SELECT auth.uid()) AND profile.active IS TRUE
  ) THEN
    RETURN QUERY SELECT DISTINCT reading.piece_id FROM public.production_stage_readings reading
      WHERE reading.piece_id IS NOT NULL AND nullif(btrim(reading.cell_name),'') IS NOT NULL;
    RETURN;
  END IF;
  allowed_cells := ARRAY(SELECT private.current_profile_authorized_cells());
  RETURN QUERY EXECUTE $scope$
    SELECT DISTINCT reading.piece_id FROM public.production_stage_readings reading
    WHERE reading.piece_id IS NOT NULL AND reading.cell_name=ANY($1::text[])
  $scope$ USING allowed_cells;
END;
$function$
;

COMMIT;

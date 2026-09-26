-- Complete lot reads and shared authorized metrics. No row deletion or retention change.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- 20260926154200_bound_production_scopes
-- Preserve exact SQL and SECURITY INVOKER; bind real scopes for indexed plans.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.collection_stage_members_for_scope(uuid,uuid,text)'::regprocedure))<>'a13ed2f4d7c1dd82ee30962a4495fa9c' THEN RAISE EXCEPTION 'BOUND_PRODUCTION_SCOPE_SOURCE_MISMATCH: public.collection_stage_members_for_scope(uuid,uuid,text)'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.collection_stage_members_for_scope(p_batch_id uuid, p_lot_id uuid, p_step_code text)
 RETURNS TABLE(id uuid, logical_piece_id uuid, status text, rework_status text, replacement_status text, is_replacement boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$BEGIN
  -- The SQL and invoker privileges are unchanged. EXECUTE plans with the
  -- actual lot/batch parameters instead of scanning every lot for nullable filters.
  RETURN QUERY EXECUTE $bound_scope$
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
    AND ($2 IS NULL OR piece.lot_id=$2)
    AND ($1 IS NULL OR coalesce(piece.pcp_import_batch_id,lot.pcp_import_batch_id)=$1)
), routes AS MATERIALIZED (
  SELECT DISTINCT route_steps,requires_cut,requires_edge,requires_cnc,
    requires_joinery,requires_separation,requires_packaging FROM scoped
), required AS MATERIALIZED (
  SELECT * FROM routes WHERE public.piece_requires_routing_step($3,
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
$bound_scope$
    USING p_batch_id, p_lot_id, p_step_code;
END;
$function$
;
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.production_piece_accounting_for_scope(uuid,uuid)'::regprocedure))<>'0ee14c73287653ed8cfc2d79561db3fc' THEN RAISE EXCEPTION 'BOUND_PRODUCTION_SCOPE_SOURCE_MISMATCH: public.production_piece_accounting_for_scope(uuid,uuid)'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.production_piece_accounting_for_scope(p_batch_id uuid, p_lot_id uuid)
 RETURNS TABLE(root_piece_id uuid, leaf_piece_id uuid, effective_piece_id uuid, open_replacement_id uuid, open_replacement_status text, replacement_pending boolean, replacement_depth integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$BEGIN
  -- The SQL and invoker privileges are unchanged. EXECUTE plans with the
  -- actual lot/batch parameters instead of scanning every lot for nullable filters.
  RETURN QUERY EXECUTE $bound_scope$ WITH RECURSIVE roots AS MATERIALIZED (
  SELECT piece.id FROM public.production_pieces piece
  WHERE COALESCE(piece.is_replacement,false) IS FALSE
    AND ($1 IS NULL OR piece.pcp_import_batch_id=$1)
    AND ($2 IS NULL OR piece.lot_id=$2)
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
);$bound_scope$
    USING p_batch_id, p_lot_id;
END;
$function$
;


-- 20260926154800_projector_early_groups
-- Group before canonicalization and reuse the root row for ordinary pieces.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_lot_route_stage_progress(uuid)'::regprocedure))<>'72987fbe86b94810f9119f02a5ed54d8' THEN RAISE EXCEPTION 'EARLY_GROUP_SOURCE_MISMATCH: public.get_lot_route_stage_progress(uuid)'; END IF; END; $guard$;
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
    case when accounting.effective_piece_id=root.id then root.completed_steps
      else effective.completed_steps end as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join lateral (
    select candidate.completed_steps from public.production_pieces candidate
    where candidate.id=accounting.effective_piece_id
      and accounting.effective_piece_id is distinct from root.id
    offset 0
  ) effective on true
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
-- Group raw states before normalization. Each group retains its exact
-- piece count; equivalent aliases can remain separate until the final sums.
raw_piece_groups as materialized (
  select lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending,
    count(*)::bigint as piece_count
  from scoped_pieces
  group by lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending
),
piece_groups as materialized (
  select lot_id, has_explicit_route,
    public.canonicalize_production_route(raw_route_steps) as route_steps,
    public.canonicalize_production_route(raw_completed_steps) as completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending, piece_count
  from raw_piece_groups
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
      $function$
;
DO $guard$ BEGIN IF md5(pg_get_functiondef('private.get_lot_route_stage_progress_uncached_capacity(uuid)'::regprocedure))<>'2f20babc8e4ab4a7ae9c3ee632c95b4a' THEN RAISE EXCEPTION 'EARLY_GROUP_SOURCE_MISMATCH: private.get_lot_route_stage_progress_uncached_capacity(uuid)'; END IF; END; $guard$;
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
    case when accounting.effective_piece_id=root.id then root.completed_steps
      else effective.completed_steps end as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join lateral (
    select candidate.completed_steps from public.production_pieces candidate
    where candidate.id=accounting.effective_piece_id
      and accounting.effective_piece_id is distinct from root.id
    offset 0
  ) effective on true
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
-- Group raw states before normalization. Each group retains its exact
-- piece count; equivalent aliases can remain separate until the final sums.
raw_piece_groups as materialized (
  select lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending,
    count(*)::bigint as piece_count
  from scoped_pieces
  group by lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending
),
piece_groups as materialized (
  select lot_id, has_explicit_route,
    public.canonicalize_production_route(raw_route_steps) as route_steps,
    public.canonicalize_production_route(raw_completed_steps) as completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending, piece_count
  from raw_piece_groups
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
$function$
;


-- 20260926163000_bound_panel_read_scopes
-- Bound panel read scopes retain every authorization branch and underlying RLS.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.current_profile_readable_order_ids()'::regprocedure))<>'f0d14712758d4c8361748727e3f479c7' THEN RAISE EXCEPTION 'BOUND_PANEL_SCOPE_SOURCE_MISMATCH: public.current_profile_readable_order_ids()'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.current_profile_readable_order_ids()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE allowed_cells text[]; allowed_lots uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN; END IF;
  IF public.current_profile_has_global_cell_access() THEN
    RETURN QUERY SELECT id FROM public.production_orders;
    RETURN;
  END IF;
  allowed_cells := ARRAY(SELECT private.current_profile_authorized_cells());
  allowed_lots := ARRAY(SELECT public.current_profile_readable_lot_ids());
  RETURN QUERY EXECUTE $scope$
    WITH allowed AS MATERIALIZED (SELECT unnest($1::text[]) AS name),
    allowed_lots AS MATERIALIZED (SELECT unnest($2::uuid[]) AS id),
    accessible AS (
      SELECT entry.production_order_id AS id FROM public.production_entries entry
      JOIN allowed ON allowed.name=entry.cell
      UNION
      SELECT coalesce(lot.production_order_id,lot.order_id) FROM public.production_lots lot
      JOIN allowed_lots ON allowed_lots.id=lot.id
    )
    SELECT orders.id FROM public.production_orders orders JOIN accessible ON accessible.id=orders.id
  $scope$ USING allowed_cells,allowed_lots;
END;
$function$
;
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_general_lot_tracking_base(uuid,integer)'::regprocedure))<>'b51f74b504ee57d65f637fd8baa906a3' THEN RAISE EXCEPTION 'BOUND_PANEL_SCOPE_SOURCE_MISMATCH: public.get_general_lot_tracking_base(uuid,integer)'; END IF; END; $guard$;
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
  result jsonb; allowed_lots uuid[]; allowed_orders uuid[]; allowed_recorded uuid[]; allowed_cells text[];
BEGIN
  IF NOT public.current_profile_has_global_cell_access() THEN
    allowed_cells:=ARRAY(SELECT public.current_profile_readable_cell_names());
    -- Keep both original RLS paths: named authorized cells and legacy readings
    -- with no cell, whose piece/lot authorization remains enforced by RLS.
    statement:=replace(statement,'from public.production_stage_readings r',
      $read_scope$from (
        select source.* from public.production_stage_readings source
        where source.cell_name=ANY($6::text[]) AND nullif(btrim(source.cell_name),'') IS NOT NULL
        union all
        select source.* from public.production_stage_readings source
        where nullif(btrim(source.cell_name),'') IS NULL
      ) r$read_scope$);
    allowed_lots:=ARRAY(SELECT public.current_profile_readable_lot_ids());
    allowed_orders:=ARRAY(SELECT public.current_profile_readable_order_ids());
    allowed_recorded:=ARRAY(SELECT public.current_profile_readable_recorded_piece_ids());
    statement:=replace(statement,'/* authorized_piece_lookup */',
      'and (p.lot_id=ANY($3) or p.production_order_id=ANY($4) or p.id=ANY($5))');
  END IF;
  EXECUTE statement INTO result USING p_batch_id,p_limit,allowed_lots,allowed_orders,allowed_recorded,allowed_cells;
  RETURN result;
END;
$function$
;
CREATE INDEX idx_stage_readings_approved_legacy_time
  ON public.production_stage_readings(created_at)
  WHERE status='approved' AND nullif(btrim(cell_name),'') IS NULL;


-- 20260926164500_entry_read_scope_once
-- Keep the exact existing cell permissions; avoid reading profiles for every entry.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('profile_can_access_cell(text)'::regprocedure))<>'8eeb2c98297395580d5bbe6d7ae7a81c' THEN RAISE EXCEPTION 'ENTRY_READ_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('private.current_profile_authorized_cells()'::regprocedure))<>'80896759254cbab4bdfcd5dd8a417aa3' THEN RAISE EXCEPTION 'ENTRY_READ_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('current_profile_readable_cell_names()'::regprocedure))<>'9b2809472c81533cc13eebf508ec4955' THEN RAISE EXCEPTION 'ENTRY_READ_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_entries'
   AND policyname='production_entries_scoped_read' AND cmd='SELECT' AND qual='profile_can_access_cell(cell)')
 THEN RAISE EXCEPTION 'ENTRY_READ_POLICY_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE FUNCTION public.current_profile_has_unrestricted_entry_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT coalesce((SELECT profile.active IS TRUE AND (
    profile.role='admin' OR (profile.role IS DISTINCT FROM 'operator'
      AND array_length(coalesce(profile.managed_cells,'{}'::text[]),1) IS NULL
      AND nullif(btrim(profile.cell),'') IS NULL))
    FROM public.profiles profile WHERE profile.id=(SELECT auth.uid())),false);
$fn$;
REVOKE ALL ON FUNCTION public.current_profile_has_unrestricted_entry_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_has_unrestricted_entry_access() TO anon,authenticated,service_role;
ALTER POLICY production_entries_scoped_read ON public.production_entries USING (((SELECT public.current_profile_has_unrestricted_entry_access())
    AND nullif(btrim(cell),'') IS NOT NULL)
  OR cell IN (SELECT public.current_profile_readable_cell_names()));


-- 20260926165500_bound_lot_completion
-- Scope and group completion calculations without changing per-piece semantics or RLS.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_lot_route_completion_metrics(uuid)'::regprocedure))<>'61746db58bcb3d3678767528d9c9e068' THEN RAISE EXCEPTION 'BOUND_COMPLETION_SOURCE_MISMATCH'; END IF; END; $guard$;
CREATE OR REPLACE FUNCTION public.get_lot_route_completion_metrics(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with scoped_pieces as materialized (
  select root.id, root.lot_id, root.pcp_import_batch_id,
         accounting.replacement_pending,
         (
           coalesce(root.route_steps, '{}'::text[])
           || case when coalesce(root.requires_cut, false) then array['cut']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_edge, false) then array['edge']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_cnc, false) then array['cnc']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_joinery, false) or coalesce(root.manual_joinery, false) then array['joinery']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_separation, false) then array['separation']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_packaging, false) then array['packaging']::text[] else '{}'::text[] end
         ) as raw_required_steps,
         case when accounting.effective_piece_id=root.id then root.completed_steps
           else effective.completed_steps end as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join lateral (
    select candidate.completed_steps from public.production_pieces candidate
    where candidate.id=accounting.effective_piece_id
      and accounting.effective_piece_id is distinct from root.id
    offset 0
  ) effective on true
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
-- Equivalent raw states have identical per-piece completion metrics. Retain
-- their multiplicity before canonicalizing routes and expanding their stages.
piece_groups as materialized (
  select min(id::text)::uuid as id,lot_id,pcp_import_batch_id,replacement_pending,
    raw_required_steps,raw_completed_steps,count(*)::bigint as piece_weight
  from scoped_pieces
  group by lot_id,pcp_import_batch_id,replacement_pending,raw_required_steps,raw_completed_steps
),
pieces as materialized (
  select id,lot_id,pcp_import_batch_id,replacement_pending,piece_weight,
    public.canonicalize_production_route(raw_required_steps) as required_steps,
    public.canonicalize_production_route(raw_completed_steps) as completed_steps
  from piece_groups
),
piece_metrics as (
  select piece.id, piece.lot_id, piece.pcp_import_batch_id, piece.replacement_pending, piece.piece_weight,
         count(*) filter (where route.stage_code is not null and coalesce(policy.traceable_collection_required, true))::integer as required_operations,
         count(*) filter (where route.stage_code is not null and coalesce(policy.traceable_collection_required, true)
                           and route.stage_code = any(piece.completed_steps))::integer as completed_operations
  from pieces piece
  left join lateral unnest(piece.required_steps) route(stage_code) on true
  left join public.production_stage_policies policy on policy.stage_code = route.stage_code
  group by piece.id, piece.lot_id, piece.pcp_import_batch_id, piece.replacement_pending, piece.piece_weight
),
lot_metrics as (
  select metric.lot_id, coalesce(sum(metric.piece_weight),0)::integer as total_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.required_operations > 0 and metric.required_operations = metric.completed_operations),0)::integer as ready_for_separation_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.replacement_pending),0)::integer as replacement_pending_pieces,
         coalesce(sum(metric.required_operations * metric.piece_weight), 0)::integer as total_operations,
         coalesce(sum(metric.completed_operations * metric.piece_weight), 0)::integer as completed_operations
  from piece_metrics metric group by metric.lot_id
),
batch_metrics as (
  select coalesce(sum(metric.piece_weight),0)::integer as total_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.required_operations > 0 and metric.required_operations = metric.completed_operations),0)::integer as ready_for_separation_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.replacement_pending),0)::integer as replacement_pending_pieces,
         coalesce(sum(metric.required_operations * metric.piece_weight), 0)::integer as total_operations,
         coalesce(sum(metric.completed_operations * metric.piece_weight), 0)::integer as completed_operations
  from piece_metrics metric
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_summary', (select jsonb_build_object(
    'total_pieces', batch.total_pieces,
    'ready_for_separation_pieces', batch.ready_for_separation_pieces,
    'replacement_pending_pieces', batch.replacement_pending_pieces,
    'total_operations', batch.total_operations,
    'completed_operations', batch.completed_operations,
    'progress_percent', case when batch.total_operations > 0 then round((100.0 * batch.completed_operations / batch.total_operations)::numeric, 2) else 0.0::numeric end,
    'ready_for_separation', batch.total_pieces > 0 and batch.replacement_pending_pieces = 0 and batch.ready_for_separation_pieces = batch.total_pieces
  ) from batch_metrics batch),
  'lot_summaries', coalesce((select jsonb_object_agg(lot.lot_id::text, jsonb_build_object(
    'total_pieces', lot.total_pieces,
    'ready_for_separation_pieces', lot.ready_for_separation_pieces,
    'replacement_pending_pieces', lot.replacement_pending_pieces,
    'total_operations', lot.total_operations,
    'completed_operations', lot.completed_operations,
    'progress_percent', case when lot.total_operations > 0 then round((100.0 * lot.completed_operations / lot.total_operations)::numeric, 2) else 0.0::numeric end,
    'ready_for_separation', lot.total_pieces > 0 and lot.replacement_pending_pieces = 0 and lot.ready_for_separation_pieces = lot.total_pieces
  )) from lot_metrics lot), '{}'::jsonb)
);
$function$
;


-- 20260926170500_lot_tracking_bundle
-- One authenticated detail request; same RLS and independent completion semantics.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_general_lot_tracking(uuid,integer)'::regprocedure))<>'e0f43ff5b130d51e89ea4fd51b1d2ecf' THEN RAISE EXCEPTION 'LOT_TRACKING_BUNDLE_SOURCE_MISMATCH'; END IF; END; $guard$;
CREATE FUNCTION public.enrich_general_lot_tracking_route_v1(p_payload jsonb,p_route_progress jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $function$
declare
  payload jsonb;
  route_progress jsonb := p_route_progress;
  general_lots jsonb := '[]'::jsonb;
  client_lots jsonb;
  general_lot jsonb;
  client_lot jsonb;
  lot_stages jsonb;
  traceable_required integer;
  traceable_completed integer;
  route_complete boolean;
begin
  payload := p_payload;

  -- A listagem geral não traz lotes de clientes e deve continuar leve. A rota
  -- completa é anexada apenas quando um lote geral é aberto.
  if p_route_progress is null then
    return payload;
  end if;

  for general_lot in
    select item.value
    from jsonb_array_elements(
      coalesce(payload->'general_lots', '[]'::jsonb)
    ) item(value)
  loop
    -- The bundle supplies the same authorized route result for this batch.
    client_lots := '[]'::jsonb;

    for client_lot in
      select item.value
      from jsonb_array_elements(
        coalesce(general_lot->'client_lots', '[]'::jsonb)
      ) item(value)
    loop
      lot_stages := coalesce(
        route_progress->'lot_stages'->(client_lot->>'lot_id'),
        '[]'::jsonb
      );

      if jsonb_array_length(lot_stages) > 0 then
        select
          coalesce(sum(
            coalesce((stage.value->>'required_pieces')::integer, 0)
          ) filter (
            where coalesce(
              (stage.value->>'traceable_collection_required')::boolean,
              true
            )
          ), 0)::integer,
          coalesce(sum(
            least(
              coalesce((stage.value->>'required_pieces')::integer, 0),
              coalesce(
                (stage.value->>'effective_completed_pieces')::integer,
                (stage.value->>'completed_pieces')::integer,
                0
              )
            )
          ) filter (
            where coalesce(
              (stage.value->>'traceable_collection_required')::boolean,
              true
            )
          ), 0)::integer,
          coalesce(bool_and(
            case
              when coalesce(
                (stage.value->>'traceable_collection_required')::boolean,
                true
              )
              and coalesce((stage.value->>'required_pieces')::integer, 0) > 0
              then coalesce(
                (stage.value->>'effective_completed_pieces')::integer,
                (stage.value->>'completed_pieces')::integer,
                0
              ) >= coalesce((stage.value->>'required_pieces')::integer, 0)
              else true
            end
          ), false)
          into traceable_required, traceable_completed, route_complete
        from jsonb_array_elements(lot_stages) stage(value);

        client_lot := client_lot || jsonb_build_object(
          'stages', lot_stages,
          'total_operations', traceable_required,
          'completed_operations', traceable_completed,
          'progress_percent', case
            when traceable_required > 0
              then round(100.0 * traceable_completed / traceable_required, 2)
            else 100.0
          end,
          'ready_for_separation', route_complete
        );
      end if;

      client_lots := client_lots || jsonb_build_array(client_lot);
    end loop;

    select
      coalesce(sum(
        coalesce((stage.value->>'required_pieces')::integer, 0)
      ) filter (
        where coalesce(
          (stage.value->>'traceable_collection_required')::boolean,
          true
        )
      ), 0)::integer,
      coalesce(sum(
        least(
          coalesce((stage.value->>'required_pieces')::integer, 0),
          coalesce(
            (stage.value->>'effective_completed_pieces')::integer,
            (stage.value->>'completed_pieces')::integer,
            0
          )
        )
      ) filter (
        where coalesce(
          (stage.value->>'traceable_collection_required')::boolean,
          true
        )
      ), 0)::integer,
      coalesce(bool_and(
        case
          when coalesce(
            (stage.value->>'traceable_collection_required')::boolean,
            true
          )
          and coalesce((stage.value->>'required_pieces')::integer, 0) > 0
          then coalesce(
            (stage.value->>'effective_completed_pieces')::integer,
            (stage.value->>'completed_pieces')::integer,
            0
          ) >= coalesce((stage.value->>'required_pieces')::integer, 0)
          else true
        end
      ), false)
      into traceable_required, traceable_completed, route_complete
    from jsonb_array_elements(
      coalesce(route_progress->'batch_stages', '[]'::jsonb)
    ) stage(value);

    general_lot := general_lot || jsonb_build_object(
      'stages', coalesce(route_progress->'batch_stages', '[]'::jsonb),
      'client_lots', client_lots,
      'total_operations', traceable_required,
      'completed_operations', traceable_completed,
      'progress_percent', case
        when traceable_required > 0
          then round(100.0 * traceable_completed / traceable_required, 2)
        else 100.0
      end,
      'ready_for_separation', route_complete
    );

    general_lots := general_lots || jsonb_build_array(general_lot);
  end loop;

  return jsonb_set(payload, '{general_lots}', general_lots, true);
end;
$function$;
REVOKE ALL ON FUNCTION public.enrich_general_lot_tracking_route_v1(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enrich_general_lot_tracking_route_v1(jsonb,jsonb) TO authenticated,service_role;
CREATE FUNCTION public.get_general_lot_tracking_bundle_v1(p_batch_id uuid,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
WITH tracking AS MATERIALIZED (
 SELECT public.get_general_lot_tracking_base(p_batch_id,p_limit) value
), route AS MATERIALIZED (
 SELECT CASE WHEN p_batch_id IS NOT NULL THEN public.get_lot_route_stage_progress(p_batch_id) END value
), completion AS MATERIALIZED (
 SELECT CASE WHEN p_batch_id IS NOT NULL THEN public.get_lot_route_completion_metrics(p_batch_id) END value
)
SELECT jsonb_build_object('tracking',public.enrich_general_lot_tracking_route_v1(tracking.value,route.value),
 'route_progress',route.value,'completion_metrics',completion.value)
FROM tracking CROSS JOIN route CROSS JOIN completion;
$function$;
REVOKE ALL ON FUNCTION public.get_general_lot_tracking_bundle_v1(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_general_lot_tracking_bundle_v1(uuid,integer) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';


-- 20260926173000_cell_read_scope_once
-- Evaluate current-user cell permissions once per statement, retaining RLS.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN
IF md5(pg_get_functiondef('has_permission(text)'::regprocedure))<>'4d0dd342c2349e2b12456c96869c0acc' THEN RAISE EXCEPTION 'CELL_SCOPE_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('profile_can_access_cell(text)'::regprocedure))<>'8eeb2c98297395580d5bbe6d7ae7a81c' THEN RAISE EXCEPTION 'CELL_SCOPE_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('current_profile_readable_cell_names()'::regprocedure))<>'9b2809472c81533cc13eebf508ec4955' THEN RAISE EXCEPTION 'CELL_SCOPE_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('current_profile_has_unrestricted_entry_access()'::regprocedure))<>'5b0a68f38ceb26b54c34de2ac2101425' THEN RAISE EXCEPTION 'CELL_SCOPE_AUTHORIZATION_SOURCE_MISMATCH'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cells' AND policyname='cells_permission_write' AND qual='has_permission(''manage_cells''::text)' AND with_check IS NOT DISTINCT FROM 'has_permission(''manage_cells''::text)') THEN RAISE EXCEPTION 'CELL_SCOPE_POLICY_SOURCE_MISMATCH'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cells' AND policyname='cells_scoped_read' AND qual='(profile_can_access_cell(name) OR has_permission(''view_cells''::text) OR has_permission(''manage_cells''::text))' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'CELL_SCOPE_POLICY_SOURCE_MISMATCH'; END IF;
END; $guard$;
ALTER POLICY cells_scoped_read ON public.cells USING (((SELECT public.current_profile_has_unrestricted_entry_access())
 AND nullif(btrim(name),'') IS NOT NULL)
 OR name IN (SELECT public.current_profile_readable_cell_names())
 OR (SELECT public.has_permission('view_cells'))
 OR (SELECT public.has_permission('manage_cells')));
ALTER POLICY cells_permission_write ON public.cells USING ((SELECT public.has_permission('manage_cells')));


-- 20260926174500_shared_lot_metrics
-- Compute both lot metrics from one authorized, grouped piece scan.

SET LOCAL lock_timeout='2s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_general_lot_tracking_bundle_v1(uuid,integer)'::regprocedure))<>'8ab55a2ba7476a0aab04c4dfe42b8641' THEN RAISE EXCEPTION 'SHARED_METRICS_BUNDLE_SOURCE_MISMATCH'; END IF; IF md5(pg_get_functiondef('public.get_lot_route_stage_progress(uuid)'::regprocedure))<>'aee97ce764f26a9a9e9005ae50f28d50' THEN RAISE EXCEPTION 'SHARED_METRICS_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('public.get_lot_route_completion_metrics(uuid)'::regprocedure))<>'7d055e7027835372eda6d104cdd1aead' THEN RAISE EXCEPTION 'SHARED_METRICS_SOURCE_MISMATCH'; END IF; END; $guard$;
CREATE FUNCTION public.get_lot_route_metrics_bundle_v1(p_batch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
WITH authorized_rows as materialized (
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
    case when accounting.effective_piece_id=root.id then root.completed_steps
      else effective.completed_steps end as raw_completed_steps
  from public.production_piece_accounting_for_scope(p_batch_id, NULL::uuid) accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join lateral (
    select candidate.completed_steps from public.production_pieces candidate
    where candidate.id=accounting.effective_piece_id
      and accounting.effective_piece_id is distinct from root.id
    offset 0
  ) effective on true
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
    authorized_groups as materialized (
      select min(id::text)::uuid id,lot_id,pcp_import_batch_id,requires_cut,requires_edge,requires_cnc,requires_joinery,requires_separation,requires_packaging,manual_joinery,has_explicit_route,replacement_pending,raw_route_steps,raw_completed_steps,count(*)::bigint source_weight
      from authorized_rows group by lot_id,pcp_import_batch_id,requires_cut,requires_edge,requires_cnc,requires_joinery,requires_separation,requires_packaging,manual_joinery,has_explicit_route,replacement_pending,raw_route_steps,raw_completed_steps
    )
SELECT jsonb_build_object('route_progress',(with
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
scoped_pieces as materialized (select * from authorized_groups),
-- Group raw states before normalization. Each group retains its exact
-- piece count; equivalent aliases can remain separate until the final sums.
raw_piece_groups as materialized (
  select lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending,
    sum(source_weight)::bigint as piece_count
  from scoped_pieces
  group by lot_id, has_explicit_route, raw_route_steps, raw_completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending
),
piece_groups as materialized (
  select lot_id, has_explicit_route,
    public.canonicalize_production_route(raw_route_steps) as route_steps,
    public.canonicalize_production_route(raw_completed_steps) as completed_steps,
    requires_cut, requires_edge, requires_cnc, requires_joinery, manual_joinery,
    requires_separation, requires_packaging, replacement_pending, piece_count
  from raw_piece_groups
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
)),
 'completion_metrics',(with scoped_pieces as materialized (
  select root.id, root.lot_id, root.pcp_import_batch_id,
         root.replacement_pending,
         (
           coalesce(root.raw_route_steps, '{}'::text[])
           || case when coalesce(root.requires_cut, false) then array['cut']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_edge, false) then array['edge']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_cnc, false) then array['cnc']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_joinery, false) or coalesce(root.manual_joinery, false) then array['joinery']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_separation, false) then array['separation']::text[] else '{}'::text[] end
           || case when coalesce(root.requires_packaging, false) then array['packaging']::text[] else '{}'::text[] end
         ) as raw_required_steps,
         root.raw_completed_steps,root.source_weight
 from authorized_groups root
),
-- Equivalent raw states have identical per-piece completion metrics. Retain
-- their multiplicity before canonicalizing routes and expanding their stages.
piece_groups as materialized (
  select min(id::text)::uuid as id,lot_id,pcp_import_batch_id,replacement_pending,
    raw_required_steps,raw_completed_steps,sum(source_weight)::bigint as piece_weight
  from scoped_pieces
  group by lot_id,pcp_import_batch_id,replacement_pending,raw_required_steps,raw_completed_steps
),
pieces as materialized (
  select id,lot_id,pcp_import_batch_id,replacement_pending,piece_weight,
    public.canonicalize_production_route(raw_required_steps) as required_steps,
    public.canonicalize_production_route(raw_completed_steps) as completed_steps
  from piece_groups
),
piece_metrics as (
  select piece.id, piece.lot_id, piece.pcp_import_batch_id, piece.replacement_pending, piece.piece_weight,
         count(*) filter (where route.stage_code is not null and coalesce(policy.traceable_collection_required, true))::integer as required_operations,
         count(*) filter (where route.stage_code is not null and coalesce(policy.traceable_collection_required, true)
                           and route.stage_code = any(piece.completed_steps))::integer as completed_operations
  from pieces piece
  left join lateral unnest(piece.required_steps) route(stage_code) on true
  left join public.production_stage_policies policy on policy.stage_code = route.stage_code
  group by piece.id, piece.lot_id, piece.pcp_import_batch_id, piece.replacement_pending, piece.piece_weight
),
lot_metrics as (
  select metric.lot_id, coalesce(sum(metric.piece_weight),0)::integer as total_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.required_operations > 0 and metric.required_operations = metric.completed_operations),0)::integer as ready_for_separation_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.replacement_pending),0)::integer as replacement_pending_pieces,
         coalesce(sum(metric.required_operations * metric.piece_weight), 0)::integer as total_operations,
         coalesce(sum(metric.completed_operations * metric.piece_weight), 0)::integer as completed_operations
  from piece_metrics metric group by metric.lot_id
),
batch_metrics as (
  select coalesce(sum(metric.piece_weight),0)::integer as total_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.required_operations > 0 and metric.required_operations = metric.completed_operations),0)::integer as ready_for_separation_pieces,
         coalesce(sum(metric.piece_weight) filter (where metric.replacement_pending),0)::integer as replacement_pending_pieces,
         coalesce(sum(metric.required_operations * metric.piece_weight), 0)::integer as total_operations,
         coalesce(sum(metric.completed_operations * metric.piece_weight), 0)::integer as completed_operations
  from piece_metrics metric
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_summary', (select jsonb_build_object(
    'total_pieces', batch.total_pieces,
    'ready_for_separation_pieces', batch.ready_for_separation_pieces,
    'replacement_pending_pieces', batch.replacement_pending_pieces,
    'total_operations', batch.total_operations,
    'completed_operations', batch.completed_operations,
    'progress_percent', case when batch.total_operations > 0 then round((100.0 * batch.completed_operations / batch.total_operations)::numeric, 2) else 0.0::numeric end,
    'ready_for_separation', batch.total_pieces > 0 and batch.replacement_pending_pieces = 0 and batch.ready_for_separation_pieces = batch.total_pieces
  ) from batch_metrics batch),
  'lot_summaries', coalesce((select jsonb_object_agg(lot.lot_id::text, jsonb_build_object(
    'total_pieces', lot.total_pieces,
    'ready_for_separation_pieces', lot.ready_for_separation_pieces,
    'replacement_pending_pieces', lot.replacement_pending_pieces,
    'total_operations', lot.total_operations,
    'completed_operations', lot.completed_operations,
    'progress_percent', case when lot.total_operations > 0 then round((100.0 * lot.completed_operations / lot.total_operations)::numeric, 2) else 0.0::numeric end,
    'ready_for_separation', lot.total_pieces > 0 and lot.replacement_pending_pieces = 0 and lot.ready_for_separation_pieces = lot.total_pieces
  )) from lot_metrics lot), '{}'::jsonb)
)));
$fn$;
REVOKE ALL ON FUNCTION public.get_lot_route_metrics_bundle_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lot_route_metrics_bundle_v1(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_bundle_v1(p_batch_id uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH tracking AS MATERIALIZED (
 SELECT public.get_general_lot_tracking_base(p_batch_id,p_limit) value
), metrics AS MATERIALIZED (
 SELECT CASE WHEN p_batch_id IS NOT NULL THEN public.get_lot_route_metrics_bundle_v1(p_batch_id) END value
)
SELECT jsonb_build_object('tracking',public.enrich_general_lot_tracking_route_v1(tracking.value,(metrics.value->'route_progress')),
 'route_progress',(metrics.value->'route_progress'),'completion_metrics',(metrics.value->'completion_metrics'))
FROM tracking CROSS JOIN metrics;
$function$
;


-- 20260926180000_piece_recent_read_index
-- The traceability board orders recent pieces before applying its page limit.
-- Keep all rows and RLS; avoid sorting every piece for each viewer.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE INDEX idx_production_pieces_created_at_capacity
  ON public.production_pieces(created_at DESC);


-- 20260926182500_traceability_board_piece_groups
-- Return complete piece states grouped by lot; do not download or truncate
-- every piece on each Kanban refresh. All reads retain the caller's RLS.

SET LOCAL lock_timeout = '2s';
CREATE FUNCTION public.get_traceability_piece_groups_v1(p_lot_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  IF coalesce(cardinality(p_lot_ids), 0) > 500 THEN
    RAISE EXCEPTION 'TRACEABILITY_LOT_LIMIT' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH scope AS MATERIALIZED (
      SELECT p.id, p.lot_id, p.production_order_id, p.status, p.route_steps, p.completed_steps
      FROM public.production_pieces p
      WHERE p.lot_id = ANY(p_lot_ids)
    ), reading_states AS MATERIALIZED (
      SELECT r.lot_id, r.piece_id, r.status, r.step_name, count(*) AS reading_count
      FROM public.production_stage_readings r
      WHERE r.lot_id = ANY(p_lot_ids)
      GROUP BY r.lot_id, r.piece_id, r.status, r.step_name
    ), approved_steps AS (
      SELECT lot_id, piece_id, array_agg(DISTINCT step_name ORDER BY step_name) AS steps
      FROM reading_states WHERE status = 'approved' AND piece_id IS NOT NULL
      GROUP BY lot_id, piece_id
    ), groups AS (
      SELECT p.lot_id, p.production_order_id, p.status, p.route_steps, p.completed_steps,
        coalesce(a.steps, '{}'::text[]) AS approved_steps, count(*) AS piece_count
      FROM scope p LEFT JOIN approved_steps a ON a.piece_id = p.id AND a.lot_id = p.lot_id
      GROUP BY p.lot_id, p.production_order_id, p.status, p.route_steps, p.completed_steps, a.steps
    ), rejected AS (
      SELECT lot_id, step_name, 'rejected'::text AS status, sum(reading_count) AS reading_count
      FROM reading_states WHERE status = 'rejected' GROUP BY lot_id, step_name
    ), latest AS (
      SELECT DISTINCT ON (r.lot_id) r.* FROM public.production_stage_readings r
      WHERE r.lot_id = ANY(p_lot_ids) AND r.status = 'approved'
      ORDER BY r.lot_id, r.created_at DESC, r.id DESC
    )
    SELECT jsonb_build_object(
      'version', 1,
      'piece_count', (SELECT count(*) FROM scope),
      'groups', coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM groups g), '[]'::jsonb),
      'rejected', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM rejected r), '[]'::jsonb),
      'latest_approved', coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM latest l), '[]'::jsonb)
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_traceability_piece_groups_v1(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_traceability_piece_groups_v1(uuid[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';


NOTIFY pgrst, 'reload schema';
COMMIT;

-- AC.Prod Collection Fabric v3 — structural and transactional acceptance.
-- Safe to run against a migrated test/staging database: every test mutation is rolled back.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

-- Flags, exact RPC contracts, browser isolation and fail-closed behavior.
DO $contract$
DECLARE
  v_rpc record;
  v_oid oid;
  v_return_type oid;
  v_security_definer boolean;
  v_argument_names text[];
  v_flag_count integer;
  v_enabled_count integer;
  v_claimed jsonb;
  v_events jsonb;
  v_auth_user_id uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_device_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_definition text;
BEGIN
  IF to_regclass('private.collection_pipeline_flags') IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: collection pipeline flags table is missing';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE enabled IS TRUE)
  INTO v_flag_count, v_enabled_count
  FROM private.collection_pipeline_flags
  WHERE flag_name = ANY (ARRAY[
    'collection_pipeline_v3_ingress',
    'collection_pipeline_v3_worker',
    'collection_pipeline_v3_projection',
    'collection_pipeline_v3_broadcast'
  ]);

  IF v_flag_count <> 4 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected four Collection Fabric v3 flags, found %', v_flag_count;
  END IF;
  IF v_enabled_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: Collection Fabric v3 flags must be off before rollout';
  END IF;
  IF has_table_privilege('anon', 'private.collection_pipeline_flags', 'SELECT')
     OR has_table_privilege('authenticated', 'private.collection_pipeline_flags', 'SELECT')
     OR has_table_privilege('anon', 'private.collection_pipeline_flags', 'UPDATE')
     OR has_table_privilege('authenticated', 'private.collection_pipeline_flags', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST_FAIL: browser roles can access private pipeline flags';
  END IF;

  IF has_table_privilege('service_role', 'public.collection_processing_attempts', 'DELETE')
     OR has_table_privilege('service_role', 'public.collection_processing_attempts', 'TRUNCATE') THEN
    RAISE EXCEPTION 'TEST_FAIL: service_role can delete/truncate append-only attempts';
  END IF;

  FOR v_rpc IN
    SELECT *
    FROM (VALUES
      ('public.get_collection_pipeline_flags_v3()', ARRAY[]::text[], true, true),
      ('public.get_collection_runtime_health_v3()', ARRAY[]::text[], true, true),
      ('public.ingest_collection_batch_v3(uuid,uuid,jsonb)', ARRAY['p_batch_id', 'p_device_id', 'p_events'], true, false),
      ('public.claim_collection_batch_v3(text,integer)', ARRAY['p_worker_id', 'p_limit'], false, true),
      ('private.process_collection_batch_v3(text,jsonb)', ARRAY['p_worker_id', 'p_items'], false, true),
      ('public.process_collection_batch_v3(text,jsonb)', ARRAY['p_worker_id', 'p_items'], false, true),
      ('public.set_collection_pipeline_flag_v3(text,boolean,jsonb)', ARRAY['p_flag_name', 'p_enabled', 'p_rollout_scope'], false, true)
    ) AS expected(signature, argument_names, authenticated_execute, service_execute)
  LOOP
    v_oid := to_regprocedure(v_rpc.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: required RPC contract missing: %', v_rpc.signature;
    END IF;

    SELECT procedure_row.prorettype, procedure_row.prosecdef, procedure_row.proargnames
    INTO v_return_type, v_security_definer, v_argument_names
    FROM pg_proc procedure_row
    WHERE procedure_row.oid = v_oid;

    IF v_return_type <> 'jsonb'::regtype OR v_security_definer IS NOT TRUE THEN
      RAISE EXCEPTION
        'TEST_FAIL: % must return jsonb and be SECURITY DEFINER',
        v_rpc.signature;
    END IF;
    IF coalesce(v_argument_names, '{}'::text[]) <> v_rpc.argument_names THEN
      RAISE EXCEPTION
        'TEST_FAIL: argument names mismatch for %: %',
        v_rpc.signature,
        v_argument_names;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAIL: anon can execute %', v_rpc.signature;
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
       IS DISTINCT FROM v_rpc.authenticated_execute THEN
      RAISE EXCEPTION
        'TEST_FAIL: authenticated EXECUTE mismatch for %',
        v_rpc.signature;
    END IF;
    IF has_function_privilege('service_role', v_oid, 'EXECUTE')
       IS DISTINCT FROM v_rpc.service_execute THEN
      RAISE EXCEPTION
        'TEST_FAIL: service_role EXECUTE mismatch for %',
        v_rpc.signature;
    END IF;
  END LOOP;

  FOR v_rpc IN
    SELECT *
    FROM (VALUES
      ('public.claim_collection_projection_batch_v3(text,integer)', ARRAY['p_worker_id', 'p_limit']),
      ('private.process_collection_projection_batch_v3(text,jsonb)', ARRAY['p_worker_id', 'p_items']),
      ('public.process_collection_projection_batch_v3(text,jsonb)', ARRAY['p_worker_id', 'p_items']),
      ('public.reconcile_collection_projection_shards_v3(uuid,text)', ARRAY['p_lot_id', 'p_step_code'])
    ) AS expected(signature, argument_names)
  LOOP
    v_oid := to_regprocedure(v_rpc.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: projection RPC contract missing: %', v_rpc.signature;
    END IF;

    SELECT procedure_row.prorettype, procedure_row.prosecdef, procedure_row.proargnames
    INTO v_return_type, v_security_definer, v_argument_names
    FROM pg_proc procedure_row
    WHERE procedure_row.oid = v_oid;

    IF v_return_type <> 'jsonb'::regtype OR v_security_definer IS NOT TRUE THEN
      RAISE EXCEPTION
        'TEST_FAIL: % must return jsonb and be SECURITY DEFINER',
        v_rpc.signature;
    END IF;
    IF coalesce(v_argument_names, '{}'::text[]) <> v_rpc.argument_names THEN
      RAISE EXCEPTION
        'TEST_FAIL: argument names mismatch for %: %',
        v_rpc.signature,
        v_argument_names;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAIL: projection RPC grants invalid for %', v_rpc.signature;
    END IF;
  END LOOP;

  -- Establish the rollback posture explicitly, including the missing-row case.
  UPDATE private.collection_pipeline_flags SET enabled = false;

  v_claimed := public.claim_collection_batch_v3('acceptance-v3-flags-off', 25);
  IF v_claimed IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'TEST_FAIL: worker claim did work with its flag off: %', v_claimed;
  END IF;

  DELETE FROM private.collection_pipeline_flags
  WHERE flag_name = 'collection_pipeline_v3_worker';
  PERFORM pgmq.send(
    'collection_live_v3',
    jsonb_build_object(
      'receipt_id', gen_random_uuid(),
      'client_event_id', 'acceptance-v3-missing-worker-flag',
      'pipeline_version', 3
    )
  );
  v_claimed := public.claim_collection_batch_v3('acceptance-v3-flag-missing', 25);
  IF v_claimed IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'TEST_FAIL: missing worker flag did not fail closed: %', v_claimed;
  END IF;
  INSERT INTO private.collection_pipeline_flags (flag_name, enabled)
  VALUES ('collection_pipeline_v3_worker', false);

  PERFORM set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_auth_user_id, 'role', 'authenticated')::text,
    true
  );

  -- The 26th item is rejected before session lookup or any production write.
  SELECT jsonb_agg(jsonb_build_object(
    'client_event_id', 'acceptance-v3-limit-' || item::text,
    'raw_value', '12345678',
    'captured_at_client', clock_timestamp(),
    'device_sequence', item
  ) ORDER BY item)
  INTO v_events
  FROM generate_series(1, 26) item;

  BEGIN
    PERFORM public.ingest_collection_batch_v3(
      v_batch_id,
      v_device_id,
      jsonb_build_object(
        'operator_session_id', v_session_id,
        'source_mode', 'live',
        'events', v_events
      )
    );
    RAISE EXCEPTION 'TEST_FAIL: ingress accepted more than 25 events';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'COLLECTION_BATCH_SIZE_INVALID' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected ingress limit error: %', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM public.ingest_collection_batch_v3(
      gen_random_uuid(),
      v_device_id,
      jsonb_build_object(
        'operator_session_id', v_session_id,
        'source_mode', 'live',
        'events', jsonb_build_array(jsonb_build_object(
          'client_event_id', 'acceptance-v3-disabled-' || gen_random_uuid()::text,
          'raw_value', '12345678',
          'captured_at_client', clock_timestamp(),
          'device_sequence', 1
        ))
      )
    );
    RAISE EXCEPTION 'TEST_FAIL: ingress did not fail closed with flag off';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'COLLECTION_PIPELINE_V3_INGRESS_DISABLED' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected ingress-disabled error: %', SQLERRM;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_auth_user_id, 'role', 'service_role')::text,
    true
  );

  SELECT jsonb_agg('{}'::jsonb ORDER BY item)
  INTO v_events
  FROM generate_series(1, 26) item;

  BEGIN
    PERFORM public.process_collection_batch_v3('acceptance-v3-limit', v_events);
    RAISE EXCEPTION 'TEST_FAIL: decision processor accepted more than 25 items';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'COLLECTION_PROCESSING_BATCH_SIZE_INVALID' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected decision limit error: %', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM public.process_collection_batch_v3(
      'acceptance-v3-worker-disabled',
      jsonb_build_array('{}'::jsonb)
    );
    RAISE EXCEPTION 'TEST_FAIL: decision processor did not fail closed';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'COLLECTION_PIPELINE_V3_WORKER_DISABLED' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected worker-disabled error: %', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM public.set_collection_pipeline_flag_v3(
      'collection_pipeline_v3_worker',
      true,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAIL: worker flag enabled before ingress';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'ENABLE_COLLECTION_V3_INGRESS_BEFORE_WORKER' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected rollout-order error: %', SQLERRM;
      END IF;
  END;

  SELECT lower(pg_get_functiondef(
    'public.claim_collection_batch_v3(text,integer)'::regprocedure
  )) INTO v_definition;
  IF position('least(coalesce(p_limit, 10), 25)' IN v_definition) = 0
     OR position('collection_pipeline_v3_worker' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: decision claim lacks 25-item clamp or worker flag';
  END IF;

  v_claimed := public.claim_collection_projection_batch_v3(
    'acceptance-v3-projection-off',
    25
  );
  IF v_claimed IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'TEST_FAIL: projection claim did work with its flag off: %', v_claimed;
  END IF;

  BEGIN
    PERFORM public.process_collection_projection_batch_v3(
      'acceptance-v3-projection-limit',
      v_events
    );
    RAISE EXCEPTION 'TEST_FAIL: projection processor accepted more than 25 items';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM <> 'COLLECTION_PROJECTION_BATCH_SIZE_INVALID' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected projection limit error: %', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM public.process_collection_projection_batch_v3(
      'acceptance-v3-projection-disabled',
      jsonb_build_array('{}'::jsonb)
    );
    RAISE EXCEPTION 'TEST_FAIL: projection processor did not fail closed';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'COLLECTION_PIPELINE_V3_PROJECTION_DISABLED' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected projection-disabled error: %', SQLERRM;
      END IF;
  END;

  SELECT lower(pg_get_functiondef(
    'public.claim_collection_projection_batch_v3(text,integer)'::regprocedure
  )) INTO v_definition;
  IF position('least(coalesce(p_limit, 10), 25)' IN v_definition) = 0
     OR position('collection_pipeline_v3_projection' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: projection claim lacks 25-item clamp or projection flag';
  END IF;
END;
$contract$;

-- Durable queues are present and cannot be consumed directly by browser roles.
DO $queues_and_idempotency$
DECLARE
  v_queue_count integer;
  v_definition text;
BEGIN
  SELECT count(*)
  INTO v_queue_count
  FROM pgmq.list_queues() queue
  WHERE queue.queue_name = ANY (ARRAY[
    'collection_live_v3',
    'collection_replay_v3',
    'collection_projection_v3',
    'collection_dead_letter_v3'
  ]);
  IF v_queue_count <> 4 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected four logged PGMQ queues, found %', v_queue_count;
  END IF;

  IF has_schema_privilege('anon', 'pgmq', 'USAGE')
     OR has_schema_privilege('authenticated', 'pgmq', 'USAGE')
     OR has_schema_privilege('anon', 'pgmq', 'CREATE')
     OR has_schema_privilege('authenticated', 'pgmq', 'CREATE') THEN
    RAISE EXCEPTION 'TEST_FAIL: browser roles have USAGE on pgmq';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'pgmq'
      AND (
        has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: browser role can execute a pgmq function';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class class_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = class_row.relnamespace
    WHERE namespace_row.nspname = 'pgmq'
      AND class_row.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        has_table_privilege('anon', class_row.oid, 'SELECT')
        OR has_table_privilege('authenticated', class_row.oid, 'SELECT')
        OR has_table_privilege('anon', class_row.oid, 'INSERT')
        OR has_table_privilege('authenticated', class_row.oid, 'INSERT')
        OR has_table_privilege('anon', class_row.oid, 'UPDATE')
        OR has_table_privilege('authenticated', class_row.oid, 'UPDATE')
        OR has_table_privilege('anon', class_row.oid, 'DELETE')
        OR has_table_privilege('authenticated', class_row.oid, 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: browser role has direct privileges on a pgmq relation';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgmq_public') THEN
    IF has_schema_privilege('anon', 'pgmq_public', 'USAGE')
       OR has_schema_privilege('authenticated', 'pgmq_public', 'USAGE')
       OR has_schema_privilege('anon', 'pgmq_public', 'CREATE')
       OR has_schema_privilege('authenticated', 'pgmq_public', 'CREATE') THEN
      RAISE EXCEPTION 'TEST_FAIL: browser roles have USAGE on pgmq_public';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
      WHERE namespace_row.nspname = 'pgmq_public'
        AND (
          has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
        )
    ) THEN
      RAISE EXCEPTION 'TEST_FAIL: browser role can execute a pgmq_public function';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_row.indrelid
     AND attribute_row.attnum = ANY (index_row.indkey)
    WHERE index_row.indrelid = 'public.coletas_producao'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND attribute_row.attname = 'client_event_id'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: receipt client_event_id is not uniquely idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    WHERE index_row.indrelid = 'public.coletas_producao'::regclass
      AND index_row.indisunique
      AND lower(pg_get_indexdef(index_row.indexrelid)) LIKE '%device_id%device_sequence%'
      AND lower(pg_get_expr(index_row.indpred, index_row.indrelid)) LIKE '%device_id is not null%'
      AND lower(pg_get_expr(index_row.indpred, index_row.indrelid)) LIKE '%device_sequence is not null%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: partial device sequence idempotency index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    WHERE index_row.indrelid = 'public.production_stage_readings'::regclass
      AND index_row.indisunique
      AND lower(pg_get_indexdef(index_row.indexrelid)) LIKE '%piece_id%step_name%production_cycle%'
      AND lower(pg_get_expr(index_row.indpred, index_row.indrelid)) LIKE '%approved%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: unique approved piece/step/cycle invariant missing';
  END IF;

  SELECT lower(pg_get_functiondef(
    'public.ingest_collection_batch_v3(uuid,uuid,jsonb)'::regprocedure
  )) INTO v_definition;
  IF position('on conflict do nothing' IN v_definition) = 0
     OR position('duplicate_receipt' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: ingress idempotency/duplicate ACK contract missing';
  END IF;

  SELECT lower(pg_get_functiondef(
    'private.process_collection_batch_v3(text,jsonb)'::regprocedure
  )) INTO v_definition;
  IF position('idempotent_replay' IN v_definition) = 0
     OR position('production_collection_events' IN v_definition) = 0
     OR position('enqueue_collection_projection_v3' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: decision idempotency/outbox contract missing';
  END IF;
END;
$queues_and_idempotency$;

-- Projection trigger registry and installed row-level guards.
DO $projection_guards$
DECLARE
  v_target_name text;
  v_installed_name text;
  v_registry private.collection_projection_trigger_registry%ROWTYPE;
  v_trigger record;
  v_definition text;
BEGIN
  FOREACH v_target_name IN ARRAY ARRAY[
    'trg_sync_production_lot_stage_aggregate',
    'trg_sync_realtime_counter_stage_readings',
    'trg_sync_reading_to_event'
  ]
  LOOP
    SELECT registry.*
    INTO v_registry
    FROM private.collection_projection_trigger_registry registry
    WHERE registry.trigger_name = v_target_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TEST_FAIL: projection trigger registry missing %', v_target_name;
    END IF;
    IF v_registry.relation_name <> 'public.production_stage_readings'::regclass
       OR v_registry.guard_installed IS NOT TRUE
       OR coalesce(array_length(v_registry.installed_trigger_names, 1), 0) < 1
       OR v_registry.installed_trigger_names[1] <> v_target_name THEN
      RAISE EXCEPTION 'TEST_FAIL: projection guard registry invalid for %', v_target_name;
    END IF;
    IF v_registry.original_definition_sha256 <> encode(
      extensions.digest(v_registry.original_definition, 'sha256'),
      'hex'
    ) THEN
      RAISE EXCEPTION 'TEST_FAIL: original trigger checksum drift for %', v_target_name;
    END IF;

    FOREACH v_installed_name IN ARRAY v_registry.installed_trigger_names
    LOOP
      SELECT
        trigger_row.tgtype,
        trigger_row.tgfoid,
        pg_get_triggerdef(trigger_row.oid, false) AS definition
      INTO v_trigger
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = 'public.production_stage_readings'::regclass
        AND trigger_row.tgname = v_installed_name
        AND trigger_row.tgisinternal IS FALSE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'TEST_FAIL: installed projection guard missing: %', v_installed_name;
      END IF;
      IF v_trigger.tgfoid <> v_registry.function_name::oid THEN
        RAISE EXCEPTION 'TEST_FAIL: guarded trigger function drift: %', v_installed_name;
      END IF;

      v_definition := lower(v_trigger.definition);
      IF position('pipeline_version' IN v_definition) = 0
         OR position('<> 3' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'TEST_FAIL: v3 exclusion missing from guard %', v_installed_name;
      END IF;
      IF (v_trigger.tgtype::integer & 4) = 4
         AND position('new.pipeline_version' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'TEST_FAIL: INSERT guard does not use NEW: %', v_installed_name;
      END IF;
      IF (v_trigger.tgtype::integer & 16) = 16
         AND position('coalesce(new.pipeline_version, old.pipeline_version' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'TEST_FAIL: UPDATE guard does not coalesce NEW/OLD: %', v_installed_name;
      END IF;
      IF (v_trigger.tgtype::integer & 8) = 8
         AND position('old.pipeline_version' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'TEST_FAIL: DELETE guard does not use OLD: %', v_installed_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$projection_guards$;

-- Attempt identity is immutable while open; a finalized attempt is fully immutable.
DO $attempt_immutability$
DECLARE
  v_attempt_id bigint;
  v_client_event_id text := 'acceptance-v3-attempt-' || gen_random_uuid()::text;
BEGIN
  INSERT INTO public.collection_processing_attempts (
    client_event_id,
    attempt_number,
    worker_id,
    queue_name,
    claimed_at,
    processing_started_at
  ) VALUES (
    v_client_event_id,
    1,
    'acceptance-v3-worker',
    'collection_live_v3',
    clock_timestamp(),
    clock_timestamp()
  ) RETURNING id INTO v_attempt_id;

  BEGIN
    UPDATE public.collection_processing_attempts
    SET worker_id = 'forged-worker'
    WHERE id = v_attempt_id;
    RAISE EXCEPTION 'TEST_FAIL: attempt identity was mutable';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'COLLECTION_ATTEMPT_IDENTITY_IS_IMMUTABLE' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected attempt identity error: %', SQLERRM;
      END IF;
  END;

  UPDATE public.collection_processing_attempts
  SET processing_finished_at = clock_timestamp(),
      processing_duration_ms = 1,
      reason_code = 'ACCEPTANCE_FINALIZED'
  WHERE id = v_attempt_id;

  BEGIN
    UPDATE public.collection_processing_attempts
    SET error_message = 'must not overwrite a previous attempt'
    WHERE id = v_attempt_id;
    RAISE EXCEPTION 'TEST_FAIL: finalized attempt was mutable';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'COLLECTION_ATTEMPT_IS_IMMUTABLE' THEN
        RAISE EXCEPTION 'TEST_FAIL: unexpected finalized attempt error: %', SQLERRM;
      END IF;
  END;

END;
$attempt_immutability$;

-- Outbox, projection idempotency and counter shards.
DO $outbox_and_shards$
DECLARE
  v_relation text;
  v_definition text;
  v_outbox_id uuid;
  v_first_application boolean;
  v_replayed_application boolean;
  v_application_count integer;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.collection_projection_outbox',
    'public.collection_projection_applied',
    'public.production_lot_stage_counter_shards'
  ]
  LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: projection relation missing: %', v_relation;
    END IF;
    IF NOT (SELECT class_row.relrowsecurity FROM pg_class class_row WHERE class_row.oid = to_regclass(v_relation)) THEN
      RAISE EXCEPTION 'TEST_FAIL: RLS disabled on %', v_relation;
    END IF;
    IF has_table_privilege('anon', v_relation, 'SELECT')
       OR (
         v_relation <> 'public.production_lot_stage_counter_shards'
         AND has_table_privilege('authenticated', v_relation, 'SELECT')
       )
       OR has_table_privilege('anon', v_relation, 'INSERT')
       OR has_table_privilege('authenticated', v_relation, 'INSERT')
       OR has_table_privilege('anon', v_relation, 'UPDATE')
       OR has_table_privilege('authenticated', v_relation, 'UPDATE')
       OR has_table_privilege('anon', v_relation, 'DELETE')
       OR has_table_privilege('authenticated', v_relation, 'DELETE') THEN
      RAISE EXCEPTION 'TEST_FAIL: browser role can mutate/read %', v_relation;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
    'authenticated',
    'public.production_lot_stage_counter_shards',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: authenticated cannot read shard totals through the security-invoker view';
  END IF;

  IF to_regclass('public.production_lot_stage_counter_totals_v3') IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: shard compatibility view missing';
  END IF;
  SELECT lower(pg_get_viewdef('public.production_lot_stage_counter_totals_v3'::regclass, true))
  INTO v_definition;
  IF position('sum(' IN v_definition) = 0
     OR position('approved_count' IN v_definition) = 0
     OR position('quantity_total' IN v_definition) = 0
     OR position('group by' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: shard totals view does not aggregate counters';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.collection_projection_outbox'::regclass
      AND constraint_row.contype = 'u'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%client_event_id%'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%projection_revision%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: outbox is not revision-idempotent by client_event_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.collection_projection_applied'::regclass
      AND constraint_row.contype = 'p'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%outbox_id%projection_type%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: applied projection idempotency key missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.production_lot_stage_counter_shards'::regclass
      AND constraint_row.contype = 'p'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%lot_id%step_code%shard_number%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.production_lot_stage_counter_shards'::regclass
      AND constraint_row.contype = 'c'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%shard_number >= 0%'
      AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%shard_number < 32%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: shard key/range invariant missing';
  END IF;

  INSERT INTO public.collection_projection_outbox (
    client_event_id,
    decision,
    quantity,
    payload
  ) VALUES (
    'acceptance-v3-outbox-' || gen_random_uuid()::text,
    'rejected',
    1,
    jsonb_build_object('acceptance', true)
  ) RETURNING id INTO v_outbox_id;

  v_first_application := private.mark_collection_projection_v3(
    v_outbox_id,
    'acceptance_projection',
    jsonb_build_object('delta', 1)
  );
  v_replayed_application := private.mark_collection_projection_v3(
    v_outbox_id,
    'acceptance_projection',
    jsonb_build_object('delta', 1)
  );
  SELECT count(*) INTO v_application_count
  FROM public.collection_projection_applied
  WHERE outbox_id = v_outbox_id
    AND projection_type = 'acceptance_projection';
  IF v_first_application IS NOT TRUE
     OR v_replayed_application IS NOT FALSE
     OR v_application_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: replay produced more than one projection application';
  END IF;

  SELECT lower(pg_get_functiondef(
    'private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure
  )) INTO v_definition;
  IF position('mark_collection_projection_v3' IN v_definition) = 0
     OR position('production_lot_stage_counter_shards' IN v_definition) = 0
     OR position('on conflict' IN v_definition) = 0
     OR position('collection_projection_v3' IN v_definition) = 0
     OR position('previous_decision' IN v_definition) = 0
     OR position('legacy_production_entry_reversal' IN v_definition) = 0
     OR position('% 16' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: projector lacks idempotent outbox/shard application';
  END IF;

  SELECT lower(pg_get_functiondef(
    'private.mark_collection_projection_v3(uuid,text,jsonb)'::regprocedure
  )) INTO v_definition;
  IF position('collection_projection_applied' IN v_definition) = 0
     OR position('on conflict (outbox_id, projection_type) do nothing' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: projection application marker is not idempotent';
  END IF;

  SELECT lower(pg_get_functiondef(
    'public.reconcile_collection_projection_shards_v3(uuid,text)'::regprocedure
  )) INTO v_definition;
  IF position('production_stage_readings' IN v_definition) = 0
     OR position('production_lot_stage_counter_shards' IN v_definition) = 0
     OR position('% 16' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: shard reconciliation is not ledger-based';
  END IF;

  IF to_regprocedure(
    'private.enqueue_collection_projection_correction_v3()'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.production_stage_readings'::regclass
      AND trigger_row.tgname = 'trg_collection_v3_projection_correction'
      AND trigger_row.tgenabled <> 'D'
      AND trigger_row.tgisinternal IS FALSE
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: authoritative v3 correction outbox trigger missing';
  END IF;

  SELECT lower(pg_get_functiondef(
    'private.enqueue_collection_projection_correction_v3()'::regprocedure
  )) INTO v_definition;
  IF position('projection_revision' IN v_definition) = 0
     OR position('previous_decision' IN v_definition) = 0
     OR position('pgmq.send' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: correction is not revisioned and durably queued';
  END IF;
END;
$outbox_and_shards$;

-- The Realtime migration is present: require the complete private Broadcast contract.
DO $realtime_policies$
DECLARE
  v_policy_name text;
  v_prefix text;
  v_policy record;
  v_expression text;
BEGIN
  IF to_regclass('realtime.messages') IS NULL
     OR NOT (SELECT class_row.relrowsecurity FROM pg_class class_row WHERE class_row.oid = 'realtime.messages'::regclass) THEN
    RAISE EXCEPTION 'TEST_FAIL: realtime.messages RLS is unavailable';
  END IF;
  IF has_table_privilege('anon', 'realtime.messages', 'INSERT')
     OR has_table_privilege('authenticated', 'realtime.messages', 'INSERT')
     OR has_table_privilege('anon', 'realtime.messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'realtime.messages', 'UPDATE')
     OR has_table_privilege('anon', 'realtime.messages', 'DELETE')
     OR has_table_privilege('authenticated', 'realtime.messages', 'DELETE') THEN
    RAISE EXCEPTION 'TEST_FAIL: browser role can publish or mutate Realtime messages';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policies policy_row
    WHERE policy_row.schemaname = 'realtime'
      AND policy_row.tablename = 'messages'
      AND policy_row.cmd = 'SELECT'
      AND (
        'authenticated'::name = ANY (policy_row.roles)
        OR 'public'::name = ANY (policy_row.roles)
      )
      AND regexp_replace(
        lower(coalesce(policy_row.qual, '')),
        '[[:space:]()]',
        '',
        'g'
      ) IN ('', 'true')
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: broad authenticated SELECT policy exposes realtime.messages';
  END IF;

  FOR v_policy_name, v_prefix IN
    SELECT *
    FROM (VALUES
      ('collection_v3_device_broadcast_select', 'collection:device:'),
      ('collection_v3_cell_broadcast_select', 'collection:cell:'),
      ('collection_v3_event_broadcast_select', 'collection:event:')
    ) AS expected(policy_name, topic_prefix)
  LOOP
    SELECT policy_row.*
    INTO v_policy
    FROM pg_policies policy_row
    WHERE policy_row.schemaname = 'realtime'
      AND policy_row.tablename = 'messages'
      AND policy_row.policyname = v_policy_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TEST_FAIL: Realtime policy missing: %', v_policy_name;
    END IF;
    IF v_policy.cmd <> 'SELECT'
       OR NOT ('authenticated'::name = ANY (v_policy.roles)) THEN
      RAISE EXCEPTION 'TEST_FAIL: Realtime policy command/role invalid: %', v_policy_name;
    END IF;

    v_expression := lower(coalesce(v_policy.qual, '') || ' ' || coalesce(v_policy.with_check, ''));
    IF position(v_prefix IN v_expression) = 0
       OR position('broadcast' IN v_expression) = 0
       OR position('auth.uid()' IN v_expression) = 0 THEN
      RAISE EXCEPTION 'TEST_FAIL: Realtime topic authorization incomplete: %', v_policy_name;
    END IF;
    IF v_policy_name = 'collection_v3_device_broadcast_select'
       AND (
         position('operator_sessions' IN v_expression) = 0
         OR position('device_id' IN v_expression) = 0
         OR position('revoked_at' IN v_expression) = 0
       ) THEN
      RAISE EXCEPTION 'TEST_FAIL: device topic is not bound to an active device session';
    END IF;
    IF v_policy_name = 'collection_v3_cell_broadcast_select'
       AND (
         position('operator_sessions' IN v_expression) = 0
         OR position('operator_cell_assignments' IN v_expression) = 0
         OR position('cell_id' IN v_expression) = 0
       ) THEN
      RAISE EXCEPTION 'TEST_FAIL: cell topic is not bound to an authorized assignment';
    END IF;
    IF v_policy_name = 'collection_v3_event_broadcast_select'
       AND (
         position('coletas_producao' IN v_expression) = 0
         OR position('client_event_id' IN v_expression) = 0
         OR position('pipeline_version' IN v_expression) = 0
       ) THEN
      RAISE EXCEPTION 'TEST_FAIL: event topic is not bound to its authenticated v3 receipt';
    END IF;
  END LOOP;
END;
$realtime_policies$;

ROLLBACK;
SELECT 'COLLECTION_FABRIC_V3_ACCEPTANCE_OK' AS result;

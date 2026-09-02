-- AC.Prod Collection Fabric v3 — guards reversíveis dos triggers de projeção.
--
-- O banco de produção contém definições que não estão integralmente versionadas
-- no repositório. Por isso esta migration captura o DDL real no catálogo antes
-- de qualquer DROP e recria os triggers a partir dos seus metadados, sem
-- codificar novamente funções, argumentos, UPDATE OF ou cláusulas WHEN.

SET check_function_bodies = on;

CREATE OR REPLACE FUNCTION private.restore_collection_v3_projection_triggers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $restore$
DECLARE
  v_registry private.collection_projection_trigger_registry%ROWTYPE;
  v_installed_name text;
  v_relation_sql text;
  v_restored_count integer := 0;
BEGIN
  -- Um rollback operacional nunca pode deixar workers v3 produzindo fatos ou
  -- projeções enquanto os triggers síncronos originais são restaurados.
  UPDATE private.collection_pipeline_flags
  SET enabled = false,
      updated_at = clock_timestamp()
  WHERE flag_name IN (
    'collection_pipeline_v3_worker',
    'collection_pipeline_v3_projection'
  );

  FOR v_registry IN
    SELECT registry.*
    FROM private.collection_projection_trigger_registry registry
    WHERE registry.relation_name = 'public.production_stage_readings'::regclass
      AND registry.guard_installed IS TRUE
    ORDER BY registry.trigger_name
    FOR UPDATE
  LOOP
    IF cardinality(v_registry.installed_trigger_names) = 0
       OR NOT (v_registry.trigger_name = ANY(v_registry.installed_trigger_names)) THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_REGISTRY_INVALID: %',
        v_registry.trigger_name;
    END IF;

    SELECT format('%I.%I', namespace.nspname, relation.relname)
    INTO v_relation_sql
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE relation.oid = v_registry.relation_name;

    IF v_relation_sql IS NULL THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_RELATION_MISSING: %',
        v_registry.relation_name::text;
    END IF;

    -- Somente nomes que esta migration registrou como instalados podem ser
    -- removidos. O registry e os dados produtivos nunca são apagados.
    FOREACH v_installed_name IN ARRAY v_registry.installed_trigger_names
    LOOP
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %s',
        v_installed_name,
        v_relation_sql
      );
    END LOOP;

    EXECUTE v_registry.original_definition;

    UPDATE private.collection_projection_trigger_registry registry
    SET installed_trigger_names = '{}'::text[],
        guard_installed = false,
        restored_at = clock_timestamp()
    WHERE registry.trigger_name = v_registry.trigger_name;

    v_restored_count := v_restored_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'restored', true,
    'restored_trigger_count', v_restored_count,
    'worker_enabled', false,
    'projection_enabled', false,
    'restored_at', clock_timestamp()
  );
END;
$restore$;

REVOKE ALL ON FUNCTION private.restore_collection_v3_projection_triggers()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.restore_collection_v3_projection_triggers()
  TO postgres;

REVOKE ALL ON TABLE private.collection_projection_trigger_registry
  FROM PUBLIC, anon, authenticated, service_role;

DO $install_guards$
DECLARE
  v_target_names constant text[] := ARRAY[
    'trg_sync_production_lot_stage_aggregate',
    'trg_sync_realtime_counter_stage_readings',
    'trg_sync_reading_to_event'
  ];
  v_target_name text;
  v_registry private.collection_projection_trigger_registry%ROWTYPE;
  v_registry_exists boolean;
  v_guard_complete boolean;
  v_trigger record;
  v_events text[];
  v_event text;
  v_timing text;
  v_event_sql text;
  v_update_columns text;
  v_original_when text;
  v_guard_expression text;
  v_combined_when text;
  v_args_sql text;
  v_arg_value text;
  v_arg_start integer;
  v_arg_count integer;
  v_byte_index integer;
  v_installed_name text;
  v_installed_names text[];
  v_suffix text;
  v_is_first_event boolean;
  v_create_sql text;
BEGIN
  FOREACH v_target_name IN ARRAY v_target_names
  LOOP
    SELECT registry.*
    INTO v_registry
    FROM private.collection_projection_trigger_registry registry
    WHERE registry.trigger_name = v_target_name
      AND registry.relation_name = 'public.production_stage_readings'::regclass;
    v_registry_exists := FOUND;

    -- Reexecução normal: não toca em um conjunto de guards completo e ainda
    -- ligado à mesma função originalmente capturada.
    IF v_registry_exists AND v_registry.guard_installed THEN
      SELECT
        cardinality(v_registry.installed_trigger_names) > 0
        AND v_registry.trigger_name = ANY(v_registry.installed_trigger_names)
        AND count(trigger_row.oid) = cardinality(v_registry.installed_trigger_names)
        AND coalesce(bool_and(
          trigger_row.tgfoid = v_registry.function_name::oid
          AND position(
            'pipeline_version'
            IN lower(pg_get_triggerdef(trigger_row.oid, false))
          ) > 0
        ), false)
      INTO v_guard_complete
      FROM unnest(v_registry.installed_trigger_names) installed(trigger_name)
      LEFT JOIN pg_trigger trigger_row
        ON trigger_row.tgrelid = v_registry.relation_name
       AND trigger_row.tgname = installed.trigger_name
       AND trigger_row.tgisinternal IS FALSE;

      IF v_guard_complete THEN
        CONTINUE;
      END IF;

      -- Uma instalação parcial não serve como fonte de verdade. Desliga o v3,
      -- remove apenas os nomes registrados e repõe o DDL original capturado.
      UPDATE private.collection_pipeline_flags
      SET enabled = false,
          updated_at = clock_timestamp()
      WHERE flag_name IN (
        'collection_pipeline_v3_worker',
        'collection_pipeline_v3_projection'
      );

      FOREACH v_installed_name IN ARRAY v_registry.installed_trigger_names
      LOOP
        EXECUTE format(
          'DROP TRIGGER IF EXISTS %I ON public.production_stage_readings',
          v_installed_name
        );
      END LOOP;

      EXECUTE v_registry.original_definition;

      UPDATE private.collection_projection_trigger_registry registry
      SET installed_trigger_names = '{}'::text[],
          guard_installed = false,
          restored_at = clock_timestamp()
      WHERE registry.trigger_name = v_target_name;
    END IF;

    SELECT
      trigger_row.oid,
      trigger_row.tgname,
      trigger_row.tgrelid,
      trigger_row.tgfoid,
      trigger_row.tgtype,
      trigger_row.tgenabled,
      trigger_row.tgisinternal,
      trigger_row.tgconstraint,
      trigger_row.tgoldtable,
      trigger_row.tgnewtable,
      trigger_row.tgnargs,
      trigger_row.tgargs,
      trigger_row.tgattr,
      trigger_row.tgqual,
      pg_get_triggerdef(trigger_row.oid, false) AS original_definition,
      encode(
        extensions.digest(pg_get_triggerdef(trigger_row.oid, false), 'sha256'),
        'hex'
      ) AS original_definition_sha256,
      trigger_row.tgfoid::regprocedure AS function_name,
      format('%I.%I', function_namespace.nspname, function_row.proname)
        AS function_sql,
      format('%I.%I', relation_namespace.nspname, relation.relname)
        AS relation_sql
    INTO v_trigger
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    JOIN pg_proc function_row ON function_row.oid = trigger_row.tgfoid
    JOIN pg_namespace function_namespace
      ON function_namespace.oid = function_row.pronamespace
    WHERE trigger_row.tgrelid = 'public.production_stage_readings'::regclass
      AND trigger_row.tgname = v_target_name
      AND trigger_row.tgisinternal IS FALSE;

    IF NOT FOUND THEN
      -- Não há definição segura para inventar. O health check posterior exige
      -- os três registros/guards e permanecerá fail-closed.
      RAISE WARNING 'COLLECTION_V3_PROJECTION_TRIGGER_MISSING: %', v_target_name;
      CONTINUE;
    END IF;

    IF v_trigger.tgisinternal
       OR v_trigger.tgconstraint <> 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_CONSTRAINT_TRIGGER_UNSUPPORTED: %',
        v_target_name;
    END IF;

    IF (v_trigger.tgtype::integer & 1) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_STATEMENT_TRIGGER_UNSUPPORTED: %',
        v_target_name;
    END IF;

    IF (v_trigger.tgtype::integer & 32) <> 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRUNCATE_TRIGGER_UNSUPPORTED: %',
        v_target_name;
    END IF;

    IF v_trigger.tgoldtable IS NOT NULL
       OR v_trigger.tgnewtable IS NOT NULL THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRANSITION_TABLE_TRIGGER_UNSUPPORTED: %',
        v_target_name;
    END IF;

    IF (v_trigger.tgtype::integer & 64) <> 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_INSTEAD_OF_TRIGGER_UNSUPPORTED: %',
        v_target_name;
    END IF;

    IF v_registry_exists THEN
      IF v_registry.original_definition_sha256
           IS DISTINCT FROM v_trigger.original_definition_sha256
         OR v_registry.function_name IS DISTINCT FROM v_trigger.function_name THEN
        RAISE EXCEPTION 'COLLECTION_V3_ORIGINAL_TRIGGER_DRIFT: %', v_target_name;
      END IF;
    ELSE
      INSERT INTO private.collection_projection_trigger_registry (
        trigger_name,
        relation_name,
        function_name,
        original_definition,
        original_definition_sha256,
        installed_trigger_names,
        guard_installed,
        captured_at,
        restored_at
      ) VALUES (
        v_target_name,
        v_trigger.tgrelid,
        v_trigger.function_name,
        v_trigger.original_definition,
        v_trigger.original_definition_sha256,
        '{}'::text[],
        false,
        clock_timestamp(),
        NULL
      );
    END IF;

    v_events := '{}'::text[];
    IF (v_trigger.tgtype::integer & 4) <> 0 THEN
      v_events := array_append(v_events, 'INSERT');
    END IF;
    IF (v_trigger.tgtype::integer & 16) <> 0 THEN
      v_events := array_append(v_events, 'UPDATE');
    END IF;
    IF (v_trigger.tgtype::integer & 8) <> 0 THEN
      v_events := array_append(v_events, 'DELETE');
    END IF;

    IF cardinality(v_events) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_EVENT_UNSUPPORTED: %', v_target_name;
    END IF;

    v_timing := CASE
      WHEN (v_trigger.tgtype::integer & 2) <> 0 THEN 'BEFORE'
      ELSE 'AFTER'
    END;

    v_original_when := CASE
      WHEN v_trigger.tgqual IS NULL THEN NULL
      ELSE pg_get_expr(v_trigger.tgqual, v_trigger.tgrelid, true)
    END;

    -- tgargs contém C strings separadas por NUL. A leitura byte a byte preserva
    -- cada argumento real e quote_literal produz o DDL seguro equivalente.
    v_args_sql := '';
    v_arg_count := 0;
    v_arg_start := 0;
    IF v_trigger.tgnargs > 0 THEN
      FOR v_byte_index IN 0..(octet_length(v_trigger.tgargs) - 1)
      LOOP
        IF get_byte(v_trigger.tgargs, v_byte_index) = 0 THEN
          v_arg_value := convert_from(
            substring(
              v_trigger.tgargs
              FROM (v_arg_start + 1)
              FOR (v_byte_index - v_arg_start)
            ),
            'UTF8'
          );
          v_args_sql := concat_ws(
            ', ',
            nullif(v_args_sql, ''),
            quote_literal(v_arg_value)
          );
          v_arg_count := v_arg_count + 1;
          v_arg_start := v_byte_index + 1;
        END IF;
      END LOOP;

      IF v_arg_count <> v_trigger.tgnargs THEN
        RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_ARGUMENT_CAPTURE_FAILED: %',
          v_target_name;
      END IF;
    END IF;

    EXECUTE format(
      'DROP TRIGGER %I ON %s',
      v_target_name,
      v_trigger.relation_sql
    );

    v_installed_names := '{}'::text[];
    v_is_first_event := true;

    FOREACH v_event IN ARRAY v_events
    LOOP
      v_event_sql := v_event;
      IF v_event = 'UPDATE'
         AND cardinality(v_trigger.tgattr::smallint[]) > 0 THEN
        SELECT string_agg(
          quote_ident(attribute.attname),
          ', ' ORDER BY selected.ordinality
        )
        INTO v_update_columns
        FROM unnest(v_trigger.tgattr::smallint[])
          WITH ORDINALITY AS selected(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = v_trigger.tgrelid
         AND attribute.attnum = selected.attnum
         AND attribute.attnum > 0
         AND attribute.attisdropped IS FALSE;

        IF v_update_columns IS NULL THEN
          RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_UPDATE_COLUMNS_INVALID: %',
            v_target_name;
        END IF;
        v_event_sql := 'UPDATE OF ' || v_update_columns;
      END IF;

      v_guard_expression := CASE v_event
        WHEN 'INSERT' THEN 'coalesce(NEW.pipeline_version, 2) <> 3'
        WHEN 'UPDATE' THEN
          'coalesce(NEW.pipeline_version, OLD.pipeline_version, 2) <> 3'
        WHEN 'DELETE' THEN 'coalesce(OLD.pipeline_version, 2) <> 3'
      END;

      v_combined_when := CASE
        WHEN v_original_when IS NULL THEN v_guard_expression
        ELSE format('(%s) AND (%s)', v_original_when, v_guard_expression)
      END;

      IF v_is_first_event THEN
        v_installed_name := v_target_name;
      ELSE
        v_suffix := '__v3_' || lower(v_event) || '_guard';
        v_installed_name := left(v_target_name, 63 - length(v_suffix)) || v_suffix;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = v_trigger.tgrelid
          AND trigger_row.tgname = v_installed_name
          AND trigger_row.tgisinternal IS FALSE
      ) THEN
        RAISE EXCEPTION 'COLLECTION_V3_GUARD_TRIGGER_NAME_COLLISION: %',
          v_installed_name;
      END IF;

      v_create_sql := format(
        'CREATE TRIGGER %I %s %s ON %s FOR EACH ROW WHEN (%s) EXECUTE FUNCTION %s(%s)',
        v_installed_name,
        v_timing,
        v_event_sql,
        v_trigger.relation_sql,
        v_combined_when,
        v_trigger.function_sql,
        v_args_sql
      );
      EXECUTE v_create_sql;

      -- O estado enabled/replica/always também é mantido no conjunto guardado.
      IF v_trigger.tgenabled = 'D' THEN
        EXECUTE format(
          'ALTER TABLE %s DISABLE TRIGGER %I',
          v_trigger.relation_sql,
          v_installed_name
        );
      ELSIF v_trigger.tgenabled = 'R' THEN
        EXECUTE format(
          'ALTER TABLE %s ENABLE REPLICA TRIGGER %I',
          v_trigger.relation_sql,
          v_installed_name
        );
      ELSIF v_trigger.tgenabled = 'A' THEN
        EXECUTE format(
          'ALTER TABLE %s ENABLE ALWAYS TRIGGER %I',
          v_trigger.relation_sql,
          v_installed_name
        );
      END IF;

      v_installed_names := array_append(v_installed_names, v_installed_name);
      v_is_first_event := false;
    END LOOP;

    UPDATE private.collection_projection_trigger_registry registry
    SET installed_trigger_names = v_installed_names,
        guard_installed = true,
        restored_at = NULL
    WHERE registry.trigger_name = v_target_name;
  END LOOP;
END;
$install_guards$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_projection_trigger_guards',
  'collection-v3-catalog-captured-event-split-projection-trigger-guards',
  'Captura DDL real e instala guards reversíveis por evento; pipeline v2 preservado e pipeline v3 desacoplado das projeções síncronas.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

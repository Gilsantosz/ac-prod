-- Leo Flow — endurecimento da API, RLS e CRUD operacional.
--
-- Objetivos:
-- 1. retirar EXECUTE implícito de PUBLIC/anon em funções SECURITY DEFINER;
-- 2. manter explicitamente públicos somente os RPCs necessários ao login e à
--    coleta operacional sem sessão Supabase;
-- 3. remover políticas de escrita "true" e exigir identidade/permissão;
-- 4. manter inbox/outbox de integração exclusivamente no service_role.
--
-- Idempotente para permitir aplicação manual e posterior execução pelo CI.

BEGIN;

-- Novas funções deixam de nascer publicamente executáveis.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

DO $$
DECLARE
  fn record;
  anon_allowlist text[] := ARRAY[
    'calcular_integridade_do_lote',
    'get_active_general_lots_progress',
    'get_client_lot_progress',
    'get_collection_cell_snapshot',
    'get_collection_context_summary',
    'get_collection_history',
    'get_collection_history_count',
    'get_general_lot_progress',
    'get_my_role',
    'has_permission',
    'heartbeat_operator_session',
    'logout_operator_session',
    'operator_login',
    'operator_login_v2',
    'process_production_reading',
    'register_traceability_rejection',
    'resolve_piece_by_identifier',
    'resolve_production_context',
    'set_operator_session_context'
  ];
  internal_allowlist text[] := ARRAY[
    'adjust_production_realtime_counter',
    'audit_table_changes',
    'auto_confirm_user_email',
    'claim_due_report_schedules',
    'finish_collection_event',
    'get_collection_cell_snapshot_v2',
    'get_promob_token',
    'handle_alert_logs_after',
    'handle_alert_logs_before',
    'handle_new_user',
    'handle_notification_config_change',
    'prevent_backup_early_deletion',
    'process_production_reading_impl',
    'protect_profile_security_fields',
    'refresh_pcp_batch_progress',
    'refresh_production_search_index',
    'snapshot_operator_name',
    'store_promob_token',
    'sync_pcp_batch_progress_from_piece',
    'sync_realtime_counter_from_production_entry',
    'sync_realtime_counter_from_stage_reading',
    'sync_report_schedule_recipients',
    'register_manual_quantitative_production_impl',
    'verify_report_cron_secret'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );

    IF fn.proname = ANY (anon_allowlist) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role',
        fn.signature
      );
    ELSIF fn.proname = ANY (internal_allowlist) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
        fn.signature
      );
    ELSE
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
        fn.signature
      );
    END IF;
  END LOOP;
END
$$;

-- Protege a coleta mantendo o contrato atual da RPC. A implementação original
-- continua privada; a fachada exige uma sessão operacional ativa.
DO $$
BEGIN
  IF to_regprocedure('public.process_production_reading_impl(jsonb)') IS NULL THEN
    ALTER FUNCTION public.process_production_reading(jsonb)
      RENAME TO process_production_reading_impl;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_session_token text := NULLIF(btrim(p_payload ->> 'operatorSessionToken'), '');
  v_session_valid boolean := false;
BEGIN
  IF v_session_token IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Faça o login operacional antes de coletar.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.operator_sessions s
    JOIN public.operators o ON o.id = s.operator_id
    WHERE s.token_hash = encode(extensions.digest(v_session_token, 'sha256'), 'hex')
      AND s.ended_at IS NULL
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND o.active IS TRUE
      AND o.login_enabled IS TRUE
  )
  INTO v_session_valid;

  IF NOT v_session_valid THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID'
      USING ERRCODE = '42501',
            HINT = 'Entre novamente com o operador autorizado.';
  END IF;

  RETURN public.process_production_reading_impl(p_payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_production_reading_impl(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_production_reading_impl(jsonb)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.process_production_reading(jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb)
  TO anon, authenticated, service_role;

-- A baixa manual também preserva o nome público da RPC, mas somente perfis
-- autorizados no PCP/gestão chegam à implementação atômica.
DO $$
BEGIN
  IF to_regprocedure('public.register_manual_quantitative_production_impl(jsonb)') IS NULL THEN
    ALTER FUNCTION public.register_manual_quantitative_production(jsonb)
      RENAME TO register_manual_quantitative_production_impl;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.register_manual_quantitative_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.active IS DISTINCT FROM false
      AND (
        p.role = ANY (ARRAY['admin', 'manager', 'supervisor'])
        OR lower(COALESCE(p.permissions ->> 'manage_pcp', 'false')) IN ('true', '1')
      )
  ) THEN
    RAISE EXCEPTION 'PCP_PERMISSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'A baixa manual exige um perfil autorizado no PCP.';
  END IF;

  RETURN public.register_manual_quantitative_production_impl(p_payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_manual_quantitative_production_impl(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_manual_quantitative_production_impl(jsonb)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.register_manual_quantitative_production(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_manual_quantitative_production(jsonb)
  TO authenticated, service_role;

-- Revogar uma sessão exige gestor autenticado; o ID do autor vem do JWT e não
-- de um valor controlado pelo cliente.
CREATE OR REPLACE FUNCTION public.revoke_operator_session(
  p_session_id uuid,
  p_revoked_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_operators() THEN
    RAISE EXCEPTION 'OPERATOR_MANAGEMENT_PERMISSION_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.operator_sessions
  SET revoked_at = now(),
      revoked_by = (SELECT auth.uid()),
      ended_at = now(),
      end_reason = 'revoked_by_manager'
  WHERE id = p_session_id
    AND ended_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sessão não encontrada ou já encerrada.'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_operator_session(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_operator_session(uuid, uuid)
  TO authenticated, service_role;

-- Baixas manuais: nunca anônimas e somente perfis do PCP/gestão podem gravar.
ALTER TABLE public.manual_production_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manual_production_records FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.manual_production_records TO authenticated;
GRANT ALL ON TABLE public.manual_production_records TO service_role;

DROP POLICY IF EXISTS "Permitir atualizacao de manual_production_records" ON public.manual_production_records;
DROP POLICY IF EXISTS "Permitir insercao de manual_production_records" ON public.manual_production_records;
DROP POLICY IF EXISTS "Permitir leitura de manual_production_records" ON public.manual_production_records;
DROP POLICY IF EXISTS manual_production_records_read ON public.manual_production_records;
DROP POLICY IF EXISTS manual_production_records_write ON public.manual_production_records;
DROP POLICY IF EXISTS manual_production_records_insert ON public.manual_production_records;
DROP POLICY IF EXISTS manual_production_records_update ON public.manual_production_records;

CREATE POLICY manual_production_records_read
  ON public.manual_production_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE POLICY manual_production_records_insert
  ON public.manual_production_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = ANY (ARRAY['admin', 'manager', 'supervisor'])
          OR lower(COALESCE(p.permissions ->> 'manage_pcp', 'false')) IN ('true', '1')
        )
    )
  );

CREATE POLICY manual_production_records_update
  ON public.manual_production_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = ANY (ARRAY['admin', 'manager', 'supervisor'])
          OR lower(COALESCE(p.permissions ->> 'manage_pcp', 'false')) IN ('true', '1')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = ANY (ARRAY['admin', 'manager', 'supervisor'])
          OR lower(COALESCE(p.permissions ->> 'manage_pcp', 'false')) IN ('true', '1')
        )
    )
  );

-- KPIs manuais: remove acesso anônimo e exige autoria ou gestão.
ALTER TABLE public.production_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.production_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.production_entries TO authenticated;
GRANT ALL ON TABLE public.production_entries TO service_role;

DROP POLICY IF EXISTS "Permitir insercao de production_entries" ON public.production_entries;
DROP POLICY IF EXISTS "Permitir leitura de production_entries" ON public.production_entries;
DROP POLICY IF EXISTS production_entries_delete ON public.production_entries;
DROP POLICY IF EXISTS production_entries_insert ON public.production_entries;
DROP POLICY IF EXISTS production_entries_read ON public.production_entries;
DROP POLICY IF EXISTS production_entries_update ON public.production_entries;

CREATE POLICY production_entries_read
  ON public.production_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE POLICY production_entries_insert
  ON public.production_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    OR public.get_my_role() = ANY (ARRAY['admin', 'manager'])
  );

CREATE POLICY production_entries_update
  ON public.production_entries
  FOR UPDATE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.get_my_role() = ANY (ARRAY['admin', 'manager'])
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    OR public.get_my_role() = ANY (ARRAY['admin', 'manager'])
  );

CREATE POLICY production_entries_delete
  ON public.production_entries
  FOR DELETE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.get_my_role() = 'admin'
  );

-- Eventos de coleta anônimos entram exclusivamente pela RPC atômica, que
-- valida sessão operacional, idempotência e sequência produtiva.
ALTER TABLE public.production_collection_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.production_collection_events FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.production_collection_events TO authenticated;
GRANT ALL ON TABLE public.production_collection_events TO service_role;

DROP POLICY IF EXISTS collection_events_insert ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_insert_anon ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_select ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_update_own ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_update ON public.production_collection_events;

CREATE POLICY collection_events_select
  ON public.production_collection_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE POLICY collection_events_insert
  ON public.production_collection_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE POLICY collection_events_update
  ON public.production_collection_events
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
  );

-- Histórico/auditoria: a identidade gravada deve ser a identidade da sessão.
DROP POLICY IF EXISTS alert_action_history_insert ON public.alert_action_history;
CREATE POLICY alert_action_history_insert
  ON public.alert_action_history
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS audit_insert_all_auth ON public.system_audit_logs;
CREATE POLICY audit_insert_all_auth
  ON public.system_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS trace_logs_insert ON public.traceability_logs;
CREATE POLICY trace_logs_insert
  ON public.traceability_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pcp_logs_insert ON public.pcp_import_logs;
CREATE POLICY pcp_logs_insert
  ON public.pcp_import_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      public.get_my_role() = ANY (ARRAY['admin', 'manager'])
      OR public.has_permission('manage_pcp')
    )
  );

-- Alertas são resolvidos pela RPC resolve_mes_alert; atualização direta fica
-- restrita à gestão para impedir que um alerta desapareça e reapareça.
DROP POLICY IF EXISTS alert_logs_insert ON public.alert_logs;
DROP POLICY IF EXISTS alert_logs_read ON public.alert_logs;
DROP POLICY IF EXISTS alert_logs_update ON public.alert_logs;

CREATE POLICY alert_logs_read
  ON public.alert_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE POLICY alert_logs_insert
  ON public.alert_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
  );

CREATE POLICY alert_logs_update
  ON public.alert_logs
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor']))
  WITH CHECK (public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor']));

-- Embalagem/expedição: USING e WITH CHECK usam a mesma autorização.
DROP POLICY IF EXISTS cc_update ON public.customer_covers;
CREATE POLICY cc_update
  ON public.customer_covers
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
    OR public.has_permission('manage_pcp')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
    OR public.has_permission('manage_pcp')
  );

DROP POLICY IF EXISTS packing_volumes_update ON public.packing_volumes;
CREATE POLICY packing_volumes_update
  ON public.packing_volumes
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

DROP POLICY IF EXISTS cce_update ON public.customer_cover_events;
CREATE POLICY cce_update
  ON public.customer_cover_events
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

DROP POLICY IF EXISTS packing_scans_update ON public.packing_scans;
CREATE POLICY packing_scans_update
  ON public.packing_scans
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

DROP POLICY IF EXISTS packing_volume_items_update ON public.packing_volume_items;
CREATE POLICY packing_volume_items_update
  ON public.packing_volume_items
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

DROP POLICY IF EXISTS replacement_orders_manage ON public.replacement_orders;
DROP POLICY IF EXISTS replacement_orders_insert ON public.replacement_orders;
DROP POLICY IF EXISTS replacement_orders_update ON public.replacement_orders;
DROP POLICY IF EXISTS replacement_orders_delete ON public.replacement_orders;

CREATE POLICY replacement_orders_insert
  ON public.replacement_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (
      public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
      OR public.has_permission('manage_quality')
    )
  );

CREATE POLICY replacement_orders_update
  ON public.replacement_orders
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
    OR public.has_permission('manage_quality')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager', 'supervisor'])
    OR public.has_permission('manage_quality')
  );

CREATE POLICY replacement_orders_delete
  ON public.replacement_orders
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_quality')
  );

DROP POLICY IF EXISTS shipment_items_write ON public.shipment_items;
DROP POLICY IF EXISTS shipment_items_insert ON public.shipment_items;
DROP POLICY IF EXISTS shipment_items_update ON public.shipment_items;
DROP POLICY IF EXISTS shipment_items_delete ON public.shipment_items;

CREATE POLICY shipment_items_insert
  ON public.shipment_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

CREATE POLICY shipment_items_update
  ON public.shipment_items
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

CREATE POLICY shipment_items_delete
  ON public.shipment_items
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

DROP POLICY IF EXISTS shipment_scans_write ON public.shipment_scans;
DROP POLICY IF EXISTS shipment_scans_insert ON public.shipment_scans;
DROP POLICY IF EXISTS shipment_scans_update ON public.shipment_scans;
DROP POLICY IF EXISTS shipment_scans_delete ON public.shipment_scans;

CREATE POLICY shipment_scans_insert
  ON public.shipment_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    operator_id IS NULL
    OR operator_id = (SELECT auth.uid())
    OR public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

CREATE POLICY shipment_scans_update
  ON public.shipment_scans
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  )
  WITH CHECK (
    operator_id IS NULL
    OR operator_id = (SELECT auth.uid())
    OR public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

CREATE POLICY shipment_scans_delete
  ON public.shipment_scans
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = ANY (ARRAY['admin', 'manager'])
    OR public.has_permission('manage_packaging')
  );

-- A fila persistida antiga não é a fila offline do navegador. Mantê-la apenas
-- para manutenção administrativa evita injeção arbitrária de payloads.
DROP POLICY IF EXISTS offline_queue_own ON public.offline_event_queue;
DROP POLICY IF EXISTS offline_queue_admin_only ON public.offline_event_queue;
CREATE POLICY offline_queue_admin_only
  ON public.offline_event_queue
  FOR ALL TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['admin', 'manager']))
  WITH CHECK (public.get_my_role() = ANY (ARRAY['admin', 'manager']));

-- Inbox/outbox são componentes internos de integração: service_role apenas.
DROP POLICY IF EXISTS integration_inbox_service_role ON public.integration_inbox;
CREATE POLICY integration_inbox_service_role
  ON public.integration_inbox
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS integration_outbox_service_role ON public.integration_outbox;
CREATE POLICY integration_outbox_service_role
  ON public.integration_outbox
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.integration_inbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.integration_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.integration_inbox TO service_role;
GRANT ALL ON TABLE public.integration_outbox TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

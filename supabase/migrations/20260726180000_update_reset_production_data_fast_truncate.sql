-- ============================================================
-- AC.Prod — MES: Atualização da Função RPC reset_production_data
-- Migration 20260726180000 — Truncate rápido para zerar lotes do PCP
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_production_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Verificar se o usuário que chamou é admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permissão insuficiente. Apenas administradores podem zerar os dados de produção.';
  END IF;

  -- 1. Desativar trigger de retenção de backups caso exista
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_backup_files_no_early_delete') THEN
    ALTER TABLE public.backup_files DISABLE TRIGGER trg_backup_files_no_early_delete;
  END IF;

  -- 2. Limpar instantaneamente todas as tabelas de lotes, ordens, peças e apontamentos de PCP
  -- utilizando TRUNCATE TABLE ... RESTART IDENTITY CASCADE para evitar locks e statement timeouts.
  TRUNCATE TABLE
    public.alert_action_history,
    public.alert_logs,
    public.backup_files,
    public.customer_cover_events,
    public.customer_covers,
    public.flow_exceptions,
    public.integration_inbox,
    public.integration_outbox,
    public.lot_items,
    public.lot_step_events,
    public.manual_production_records,
    public.occurrences,
    public.offline_event_queue,
    public.package_items,
    public.packages,
    public.packing_scans,
    public.packing_volume_items,
    public.packing_volumes,
    public.pcp_import_logs,
    public.pcp_import_rows,
    public.piece_instances,
    public.production_collection_events,
    public.production_entries,
    public.production_events,
    public.production_lot_items,
    public.production_lots,
    public.production_order_items,
    public.production_orders,
    public.production_pieces,
    public.production_realtime_counters,
    public.production_routes,
    public.production_search_index,
    public.production_stage_readings,
    public.production_tags,
    public.promob_import_batches,
    public.promob_import_differences,
    public.quality_nonconformities,
    public.replacement_orders,
    public.rework_orders,
    public.shipment_exceptions,
    public.shipment_items,
    public.shipment_scans,
    public.shipments,
    public.traceability_logs
  RESTART IDENTITY CASCADE;

  -- 3. Reativar trigger de retenção de backups caso exista
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_backup_files_no_early_delete') THEN
    ALTER TABLE public.backup_files ENABLE TRIGGER trg_backup_files_no_early_delete;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Dados dos Lotes importados do PCP e apontamentos operacionais zerados com sucesso! Usuários, operadores, células e máquinas foram mantidos.'
  );
EXCEPTION WHEN OTHERS THEN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_backup_files_no_early_delete') THEN
    BEGIN
      ALTER TABLE public.backup_files ENABLE TRIGGER trg_backup_files_no_early_delete;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_production_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_production_data() TO service_role;
COMMENT ON FUNCTION public.reset_production_data() IS
  'Reseta apenas os dados referentes aos Lotes enviados para o PCP (OPs, Lotes, Peças, Leituras, Ocorrências e Backups) mantendo cadastros de usuários, operadores, células e máquinas intactos.';

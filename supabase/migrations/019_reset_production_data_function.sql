-- ============================================================
-- AC.Prod — MES Fase 2: Função para Zerar Dados de Produção
-- Migration 019 — Aditiva (RPC reset_production_data)
-- ============================================================

CREATE OR REPLACE FUNCTION reset_production_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
BEGIN
  -- Verificar se o usuário que chamou é admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permissão insuficiente. Apenas administradores podem zerar os dados de produção.';
  END IF;

  -- 1. Limpar arquivos do Storage Bucket
  DELETE FROM storage.objects WHERE bucket_id = 'productive-backups';

  -- 2. Limpar tabelas na ordem de dependência
  DELETE FROM public.alert_logs;
  DELETE FROM public.promob_import_differences;
  DELETE FROM public.occurrences;
  DELETE FROM public.production_collection_events;
  DELETE FROM public.lot_step_events;
  DELETE FROM public.traceability_logs;
  DELETE FROM public.package_items;
  DELETE FROM public.packages;
  DELETE FROM public.shipments;
  DELETE FROM public.production_stage_readings;
  DELETE FROM public.production_tags;
  DELETE FROM public.production_lot_items;
  DELETE FROM public.lot_items;
  DELETE FROM public.production_routes;
  DELETE FROM public.backup_files;
  DELETE FROM public.promob_import_batches;
  DELETE FROM public.pcp_import_logs;
  DELETE FROM public.production_entries;
  DELETE FROM public.production_lots;
  DELETE FROM public.production_order_items;
  DELETE FROM public.production_orders;
  DELETE FROM public.piece_instances;
  DELETE FROM public.production_search_index;

  RETURN jsonb_build_object('success', true, 'message', 'Dados de peças e produção zerados com sucesso. Usuários, operadores e células mantidos.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION reset_production_data() TO authenticated;
COMMENT ON FUNCTION reset_production_data() IS
  'Reseta todos os dados relativos a peças, ordens de produção, lotes, leituras, ocorrências e arquivos de backup, mantendo perfis, operadores e células intactos. Apenas admins.';

-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 015: Portal PCP - Logs, Integrações e Backup de 4 anos
-- ============================================================

-- ─── 1. Adaptação da Tabela promob_import_batches ──────────────
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS total_parts integer DEFAULT 0;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS total_errors integer DEFAULT 0;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS total_warnings integer DEFAULT 0;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS generated_op_id uuid REFERENCES production_orders(id) ON DELETE SET NULL;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS retention_until timestamptz;
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS backup_status text DEFAULT 'pending';
ALTER TABLE promob_import_batches ADD COLUMN IF NOT EXISTS notes text;

-- Atualizar CHECK de status para incluir novos estados
ALTER TABLE promob_import_batches DROP CONSTRAINT IF EXISTS promob_import_batches_status_check;
ALTER TABLE promob_import_batches ADD CONSTRAINT promob_import_batches_status_check
  CHECK (status IN ('pending', 'parsed', 'validated_success', 'validated_warnings', 'failed_validation', 'processed', 'duplicated', 'error', 'cancelled'));

-- Atualizar CHECK de backup_status
ALTER TABLE promob_import_batches DROP CONSTRAINT IF EXISTS promob_import_batches_backup_status_check;
ALTER TABLE promob_import_batches ADD CONSTRAINT promob_import_batches_backup_status_check
  CHECK (backup_status IN ('pending', 'realizado', 'falhou', 'nao_aplicavel'));

-- ─── 2. Tabela de Logs de Importação (pcp_import_logs) ────────
CREATE TABLE IF NOT EXISTS pcp_import_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_file_id  uuid NOT NULL REFERENCES promob_import_batches(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  message         text NOT NULL,
  severity        text DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  created_at      timestamptz DEFAULT now(),
  metadata_json   jsonb DEFAULT '{}'
);

-- ─── 3. Tabela de Configurações de Integração ────────────────
CREATE TABLE IF NOT EXISTS pcp_integration_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_type    text NOT NULL UNIQUE CHECK (integration_type IN ('manual_upload', 'google_drive', 'promob_api', 'local_watch_folder', 'ftp', 's3')),
  enabled             boolean DEFAULT false,
  folder_path         text,
  api_key_encrypted   text,
  last_sync_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Trigger de updated_at para pcp_integration_settings
CREATE TRIGGER trg_pcp_integration_settings_updated_at
  BEFORE UPDATE ON pcp_integration_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed de configurações básicas de integração
INSERT INTO pcp_integration_settings (integration_type, enabled)
VALUES 
  ('manual_upload', true),
  ('google_drive', false),
  ('promob_api', false),
  ('local_watch_folder', false),
  ('ftp', false),
  ('s3', false)
ON CONFLICT (integration_type) DO NOTHING;

-- ─── 4. RLS (Row Level Security) ─────────────────────────────
ALTER TABLE pcp_import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcp_integration_settings ENABLE ROW LEVEL SECURITY;

-- Políticas para pcp_import_logs
CREATE POLICY "pcp_logs_select" ON pcp_import_logs
  FOR SELECT TO authenticated USING (get_my_role() IN ('admin', 'manager'));

CREATE POLICY "pcp_logs_insert" ON pcp_import_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Políticas para pcp_integration_settings
CREATE POLICY "pcp_settings_select" ON pcp_integration_settings
  FOR SELECT TO authenticated USING (get_my_role() IN ('admin', 'manager'));

CREATE POLICY "pcp_settings_all_admin" ON pcp_integration_settings
  FOR ALL TO authenticated USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

-- ─── 5. Índices de Performance ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_promob_batches_generated_op_id ON promob_import_batches(generated_op_id);
CREATE INDEX IF NOT EXISTS idx_promob_batches_created_at      ON promob_import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promob_batches_file_hash       ON promob_import_batches(file_hash);
CREATE INDEX IF NOT EXISTS idx_pcp_logs_import_file_id        ON pcp_import_logs(import_file_id);
CREATE INDEX IF NOT EXISTS idx_pcp_logs_created_at           ON pcp_import_logs(created_at DESC);

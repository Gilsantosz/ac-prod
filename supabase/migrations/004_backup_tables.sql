-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 004: Políticas de Backup Produtivo (retenção 4 anos)
-- ============================================================

CREATE TABLE IF NOT EXISTS backup_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  enabled          boolean DEFAULT true,
  backup_type      text NOT NULL
                   CHECK (backup_type IN (
                     'production_order','promob_xml','traceability_snapshot',
                     'full_productive_backup','reports'
                   )),
  frequency        text NOT NULL DEFAULT 'on_import'
                   CHECK (frequency IN ('on_import','daily','weekly','monthly')),
  time_local       time,
  timezone         text DEFAULT 'America/Sao_Paulo',
  retention_years  integer DEFAULT 4 CHECK (retention_years BETWEEN 1 AND 10),
  storage_bucket   text DEFAULT 'productive-backups',
  path_pattern     text DEFAULT '{year}/{month}/{order_code}/{lot_code}/v{revision}/',
  include_xml      boolean DEFAULT true,
  include_json     boolean DEFAULT true,
  include_pdf      boolean DEFAULT true,
  include_xlsx     boolean DEFAULT true,
  include_logs     boolean DEFAULT true,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TRIGGER trg_backup_policies_updated_at
  BEFORE UPDATE ON backup_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Política padrão de backup na importação
INSERT INTO backup_policies (name, backup_type, frequency, retention_years, path_pattern)
VALUES ('Backup Automático na Importação Promob',
        'promob_xml', 'on_import', 4,
        '{year}/{month}/{order_code}/v{revision}/')
ON CONFLICT DO NOTHING;

-- ─── Arquivos de Backup ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_policy_id   uuid REFERENCES backup_policies(id) ON DELETE SET NULL,
  order_id           uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  lot_id             uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  import_batch_id    uuid REFERENCES promob_import_batches(id) ON DELETE SET NULL,
  file_name          text NOT NULL,
  file_type          text NOT NULL
                     CHECK (file_type IN ('xml','json','pdf','xlsx','zip','log')),
  storage_path       text NOT NULL,
  file_size          bigint DEFAULT 0,
  checksum           text,
  revision           integer DEFAULT 1,
  generated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at       timestamptz DEFAULT now(),
  expires_at         timestamptz,  -- DEFAULT: now() + 4 years (definido ao inserir)
  status             text NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available','archived','expired','error')),
  error_message      text,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_files_order_id         ON backup_files(order_id);
CREATE INDEX IF NOT EXISTS idx_backup_files_lot_id           ON backup_files(lot_id);
CREATE INDEX IF NOT EXISTS idx_backup_files_import_batch_id  ON backup_files(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_backup_files_status           ON backup_files(status);
CREATE INDEX IF NOT EXISTS idx_backup_files_expires_at       ON backup_files(expires_at);
CREATE INDEX IF NOT EXISTS idx_backup_files_file_type        ON backup_files(file_type);

-- Regra: bloquear exclusão de backup antes do vencimento para não-admin
CREATE OR REPLACE FUNCTION prevent_backup_early_deletion()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid() LIMIT 1;
  IF caller_role IS DISTINCT FROM 'admin' AND OLD.expires_at > now() THEN
    RAISE EXCEPTION 'Backup não pode ser excluído antes de %.
      Apenas administradores podem forçar exclusão antecipada.',
      to_char(OLD.expires_at, 'DD/MM/YYYY');
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_backup_files_no_early_delete
  BEFORE DELETE ON backup_files
  FOR EACH ROW EXECUTE FUNCTION prevent_backup_early_deletion();

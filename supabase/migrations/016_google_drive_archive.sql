-- ============================================================
-- AC.Prod — Google Drive Archive
-- Migration 016: status de arquivamento externo para backups/OPs
-- ============================================================

ALTER TABLE backup_files
  ADD COLUMN IF NOT EXISTS external_storage_provider text,
  ADD COLUMN IF NOT EXISTS external_storage_path text,
  ADD COLUMN IF NOT EXISTS external_file_id text,
  ADD COLUMN IF NOT EXISTS external_web_url text,
  ADD COLUMN IF NOT EXISTS external_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_sync_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS external_sync_error text;

ALTER TABLE backup_files DROP CONSTRAINT IF EXISTS backup_files_external_sync_status_check;
ALTER TABLE backup_files ADD CONSTRAINT backup_files_external_sync_status_check
  CHECK (external_sync_status IN ('pending', 'synced', 'archived', 'error'));

CREATE INDEX IF NOT EXISTS idx_backup_files_external_provider
  ON backup_files(external_storage_provider, external_sync_status);

CREATE INDEX IF NOT EXISTS idx_backup_files_external_synced_at
  ON backup_files(external_synced_at DESC);

ALTER TABLE pcp_integration_settings
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_folder_name text,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settings_json jsonb DEFAULT '{}'::jsonb;

UPDATE pcp_integration_settings
SET
  folder_path = COALESCE(folder_path, 'Backups AC.Prod / Ordens de Produção'),
  settings_json = COALESCE(settings_json, '{}'::jsonb) || '{"archiveProvider":"google_drive"}'::jsonb
WHERE integration_type = 'google_drive';

INSERT INTO backup_policies (name, backup_type, frequency, retention_years, storage_bucket, path_pattern)
SELECT
  'Arquivo externo no Google Drive',
  'full_productive_backup',
  'daily',
  4,
  'google-drive',
  'AC.Prod/{year}/{month}/{order_code}/'
WHERE NOT EXISTS (
  SELECT 1 FROM backup_policies WHERE name = 'Arquivo externo no Google Drive'
);

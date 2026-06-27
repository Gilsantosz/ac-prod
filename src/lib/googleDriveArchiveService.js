import { supabase } from '@/lib/supabaseClient';

const DEFAULT_SETTING = {
  integration_type: 'google_drive',
  enabled: false,
  folder_path: '',
  drive_folder_id: '',
  last_sync_at: null,
  last_sync_status: null,
  last_sync_error: null,
  last_sync_count: 0,
};

function classifyDriveStatus(file = {}) {
  if (file.external_storage_provider !== 'google_drive') return 'pending';
  if (file.status === 'archived') return 'archived';
  return file.external_sync_status || 'synced';
}

export async function fetchGoogleDriveArchiveStatus() {
  const [settingResult, filesResult] = await Promise.all([
    supabase
      .from('pcp_integration_settings')
      .select('*')
      .eq('integration_type', 'google_drive')
      .maybeSingle(),
    supabase
      .from('backup_files')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(1000),
  ]);

  if (settingResult.error) throw settingResult.error;
  if (filesResult.error) throw filesResult.error;

  const files = filesResult.data || [];
  const totals = files.reduce((acc, file) => {
    const status = classifyDriveStatus(file);
    acc.total += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (file.status === 'available') acc.available += 1;
    return acc;
  }, { total: 0, pending: 0, synced: 0, archived: 0, error: 0, available: 0 });

  return {
    setting: settingResult.data || DEFAULT_SETTING,
    totals,
    latestFiles: files.slice(0, 8),
  };
}

export async function saveGoogleDriveArchiveSettings(values = {}) {
  const payload = {
    enabled: values.enabled === true,
    folder_path: values.folderPath || values.driveFolderId || null,
    drive_folder_id: values.driveFolderId || null,
    updated_at: new Date().toISOString(),
  };
  const legacyPayload = {
    enabled: payload.enabled,
    folder_path: payload.folder_path,
    updated_at: payload.updated_at,
  };

  const { data: existing, error: lookupError } = await supabase
    .from('pcp_integration_settings')
    .select('id')
    .eq('integration_type', 'google_drive')
    .maybeSingle();
  if (lookupError) throw lookupError;

  let result = existing?.id
    ? await supabase.from('pcp_integration_settings').update(payload).eq('id', existing.id).select('*').single()
    : await supabase.from('pcp_integration_settings').insert({ integration_type: 'google_drive', ...payload }).select('*').single();

  if (result.error?.message?.includes('drive_folder_id') || result.error?.message?.includes('schema cache')) {
    result = existing?.id
      ? await supabase.from('pcp_integration_settings').update(legacyPayload).eq('id', existing.id).select('*').single()
      : await supabase.from('pcp_integration_settings').insert({ integration_type: 'google_drive', ...legacyPayload }).select('*').single();
  }

  if (result.error) throw result.error;
  return result.data;
}

export async function syncGoogleDriveArchive({ archiveLocal = false, limit = 25 } = {}) {
  const { data, error } = await supabase.functions.invoke('sync-google-drive-archive', {
    body: { archiveLocal, limit },
  });
  if (error) throw error;
  if (!data?.success && !data?.synced) throw new Error(data?.error || 'Falha ao sincronizar com o Google Drive.');
  return data;
}

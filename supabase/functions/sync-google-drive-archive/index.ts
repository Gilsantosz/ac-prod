import { corsHeaders, json, requireAiUser } from '../_shared/aiOperations.ts';

// ----------------------------------------------------------------
// Google Drive integration using OAuth2 user refresh token
// No Service Account / Google Cloud project required.
// Secrets needed (Supabase Edge Function secrets):
//   GOOGLE_OAUTH_CLIENT_ID      — use the Playground client or your own
//   GOOGLE_OAUTH_CLIENT_SECRET  — idem
//   GOOGLE_DRIVE_REFRESH_TOKEN  — obtained via OAuth2 Playground
//   GOOGLE_DRIVE_BACKUP_FOLDER_ID — Google Drive folder ID (from folder URL)
// ----------------------------------------------------------------

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// ── OAuth2 helpers ──────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '';
  const refreshToken = Deno.env.get('GOOGLE_DRIVE_REFRESH_TOKEN') || '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Configure os segredos GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_DRIVE_REFRESH_TOKEN no Supabase.',
    );
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(
      body.error_description || body.error || 'Falha ao obter token do Google Drive.',
    );
  }
  return body.access_token as string;
}

// ── Drive API helpers ───────────────────────────────────────────

function mimeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

function escapeDriveQuery(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function driveFetch(token: string, path: string, init: RequestInit = {}) {
  const resp = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const contentType = resp.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await resp.json()
    : await resp.text();
  if (!resp.ok) {
    throw new Error(body?.error?.message || body?.error || body || 'Erro no Google Drive API.');
  }
  return body;
}

async function findDriveFile(
  token: string,
  parentId: string,
  name: string,
  folder = false,
): Promise<{ id: string; name: string; webViewLink?: string } | null> {
  const mimeFilter = folder ? " and mimeType = 'application/vnd.google-apps.folder'" : '';
  const q = `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and trashed = false${mimeFilter}`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`;
  const result = await driveFetch(token, url);
  return result.files?.[0] || null;
}

async function createDriveFolder(token: string, parentId: string, name: string) {
  return driveFetch(token, `${DRIVE_API}/files?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
}

async function ensureFolderPath(token: string, rootFolderId: string, segments: string[]) {
  let parentId = rootFolderId;
  const path: string[] = [];
  for (const segment of segments.filter(Boolean)) {
    path.push(segment);
    const existing = await findDriveFile(token, parentId, segment, true);
    parentId = existing?.id || (await createDriveFolder(token, parentId, segment)).id;
  }
  return { folderId: parentId, path: path.join('/') };
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

async function createDriveFile(
  token: string,
  parentId: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const boundary = `acprod_${crypto.randomUUID()}`;
  const mimeType = mimeFromName(fileName);
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });
  const encoder = new TextEncoder();
  const body = concatBytes([
    encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    encoder.encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    encoder.encode(`\r\n--${boundary}--`),
  ]);
  return driveFetch(
    token,
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
}

async function updateDriveFile(
  token: string,
  fileId: string,
  fileName: string,
  bytes: Uint8Array,
) {
  return driveFetch(
    token,
    `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=id,name,webViewLink,webContentLink`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': mimeFromName(fileName) },
      body: bytes,
    },
  );
}

async function uploadBackupFile(
  token: string,
  rootFolderId: string,
  backupFile: Record<string, unknown>,
  bytes: Uint8Array,
) {
  const storagePath = String(backupFile.storage_path || backupFile.file_name || '');
  const segments = storagePath.split('/').filter(Boolean);
  const fileName =
    (backupFile.file_name as string) ||
    segments.at(-1) ||
    `backup-${backupFile.id as string}.json`;
  const folderSegments = segments.slice(0, -1);
  const folder = await ensureFolderPath(token, rootFolderId, folderSegments);
  const existing = backupFile.external_file_id
    ? { id: backupFile.external_file_id as string }
    : await findDriveFile(token, folder.folderId, fileName, false);
  const uploaded = existing?.id
    ? await updateDriveFile(token, existing.id, fileName, bytes)
    : await createDriveFile(token, folder.folderId, fileName, bytes);
  return {
    ...uploaded,
    drivePath: [folder.path, fileName].filter(Boolean).join('/'),
  };
}

async function audit(
  admin: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2.49.4').createClient>,
  user: { id: string; email?: string },
  profile: { name?: string; email?: string; role?: string },
  action: string,
  metadata: Record<string, unknown>,
) {
  await (admin as any).from('system_audit_logs').insert({
    user_id: user.id,
    user_name: profile.name || user.email,
    user_email: profile.email || user.email,
    user_role: profile.role,
    action,
    entity: 'backup_file',
    method: 'edge_function',
    metadata,
    success: true,
  });
}

// ── Main handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let admin: any = null;
  let settingId: string | null = null;

  try {
    const auth = await requireAiUser(req, true);
    admin = auth.admin;
    if (auth.profile.role !== 'admin') {
      throw new Error('Apenas administradores podem arquivar backups no Google Drive.');
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 100));
    const archiveLocal = body.archiveLocal === true;

    // Read Google Drive settings from DB
    const { data: setting, error: settingError } = await admin
      .from('pcp_integration_settings')
      .select('*')
      .eq('integration_type', 'google_drive')
      .maybeSingle();
    if (settingError) throw settingError;
    settingId = setting?.id || null;
    if (!setting?.enabled) {
      throw new Error('Ative a integração Google Drive antes de sincronizar.');
    }

    const rootFolderId =
      Deno.env.get('GOOGLE_DRIVE_BACKUP_FOLDER_ID') ||
      setting.drive_folder_id ||
      (!String(setting.folder_path || '').includes('/')
        ? String(setting.folder_path || '')
        : '');
    if (!rootFolderId) {
      throw new Error(
        'Informe o ID da pasta do Google Drive nas configurações ou no segredo GOOGLE_DRIVE_BACKUP_FOLDER_ID.',
      );
    }

    // Query backup files
    let query = admin
      .from('backup_files')
      .select('*')
      .eq('status', 'available')
      .order('generated_at', { ascending: false })
      .limit(limit);
    if (body.backupFileId) query = query.eq('id', body.backupFileId);
    if (body.orderId) query = query.eq('order_id', body.orderId);

    const { data: files, error: filesError } = await query;
    if (filesError) throw filesError;
    if (!files?.length) {
      return json({
        success: true,
        synced: 0,
        archived: 0,
        failed: 0,
        message: 'Nenhum backup local pendente para sincronizar.',
      });
    }

    // Get OAuth2 access token from stored refresh token
    const token = await getAccessToken();

    const results: Array<Record<string, unknown>> = [];
    for (const file of files) {
      try {
        // Download from Supabase Storage
        const { data: blob, error: downloadError } = await admin.storage
          .from('productive-backups')
          .download(file.storage_path);
        if (downloadError) throw downloadError;
        const bytes = new Uint8Array(await blob.arrayBuffer());

        // Upload to Google Drive
        const uploaded = await uploadBackupFile(token, rootFolderId, file, bytes);

        // Optionally remove from Supabase Storage
        if (archiveLocal) {
          const { error: removeError } = await admin.storage
            .from('productive-backups')
            .remove([file.storage_path]);
          if (removeError) throw removeError;
        }

        // Update DB record
        await admin
          .from('backup_files')
          .update({
            external_storage_provider: 'google_drive',
            external_storage_path: uploaded.drivePath,
            external_file_id: uploaded.id,
            external_web_url: uploaded.webViewLink || uploaded.webContentLink || null,
            external_synced_at: new Date().toISOString(),
            external_sync_status: archiveLocal ? 'archived' : 'synced',
            external_sync_error: null,
            status: archiveLocal ? 'archived' : file.status,
          })
          .eq('id', file.id);

        results.push({
          id: file.id,
          fileName: file.file_name,
          success: true,
          archived: archiveLocal,
          driveFileId: uploaded.id,
          driveUrl: uploaded.webViewLink || null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await admin
          .from('backup_files')
          .update({ external_sync_status: 'error', external_sync_error: message })
          .eq('id', file.id);
        results.push({ id: file.id, fileName: file.file_name, success: false, error: message });
      }
    }

    const synced = results.filter((r) => r.success).length;
    const failed = results.length - synced;

    if (settingId) {
      await admin
        .from('pcp_integration_settings')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: failed ? 'partial_error' : 'synced',
          last_sync_error: failed ? `${failed} arquivo(s) falharam.` : null,
          last_sync_count: synced,
        })
        .eq('id', settingId);
    }

    await audit(admin, auth.user, auth.profile, 'google_drive_archive_sync', {
      synced,
      failed,
      archiveLocal,
      fileIds: results.map((r) => r.id),
    });

    return json(
      {
        success: failed === 0,
        synced,
        archived: archiveLocal ? synced : 0,
        failed,
        results,
        message: archiveLocal
          ? `${synced} arquivo(s) enviados ao Google Drive e arquivados localmente.`
          : `${synced} arquivo(s) sincronizados com o Google Drive.`,
      },
      failed ? 207 : 200,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (admin && settingId) {
      await admin
        .from('pcp_integration_settings')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_error: message,
        })
        .eq('id', settingId);
    }
    const status =
      message === 'AUTH_REQUIRED' ? 401 : message?.includes('Apenas administradores') ? 403 : 400;
    return json({ success: false, error: message }, status);
  }
});

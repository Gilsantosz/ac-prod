import { supabase } from '@/lib/supabaseClient';
import { isAiSchemaUnavailable } from './aiAuditService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeCells(row = {}) {
  if (Array.isArray(row.managed_cells) && row.managed_cells.length) return row.managed_cells;
  if (Array.isArray(row.cell)) return row.cell;
  if (typeof row.cell === 'string' && row.cell.trim()) {
    try {
      const parsed = JSON.parse(row.cell);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // perfil legado com célula simples em texto
    }
    return [row.cell];
  }
  return [];
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

function normalizeProfileRecipient(profile) {
  return {
    id: `profile:${profile.id}`,
    profile_id: profile.id,
    recipient_id: null,
    source: 'profile',
    source_label: profile.role === 'admin' ? 'Usuário Admin' : 'Usuário Gestor',
    name: profile.name || profile.email || 'Gestor sem nome',
    email: String(profile.email || '').trim().toLowerCase(),
    role_label: profile.role === 'admin' ? 'Administrador' : 'Gestor',
    recipient_group: 'manager',
    cell_filter: normalizeCells(profile),
    active: profile.active !== false,
  };
}

function normalizeLegacyRecipient(recipient) {
  return {
    id: `recipient:${recipient.id}`,
    profile_id: null,
    recipient_id: recipient.id,
    source: 'report_recipients',
    source_label: 'Legado IA',
    name: recipient.name || recipient.email || 'Destinatário sem nome',
    email: String(recipient.email || '').trim().toLowerCase(),
    role_label: recipient.role_label || 'Destinatário',
    recipient_group: recipient.recipient_group || 'manager',
    cell_filter: recipient.cell_filter || [],
    active: recipient.active !== false,
  };
}

function dedupeRecipients(items) {
  const byEmail = new Map();
  items
    .filter((item) => item.active !== false && isValidEmail(item.email))
    .forEach((item) => {
      const key = item.email.toLowerCase();
      const current = byEmail.get(key);
      // profiles são a fonte oficial. O cadastro legado da IA só fica como fallback.
      if (!current || item.source === 'profile') byEmail.set(key, item);
    });
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function splitRecipientRefs(recipientRefs = []) {
  const profileIds = [];
  const reportRecipientIds = [];
  const recipientEmails = [];

  toArray(recipientRefs).forEach((ref) => {
    const value = String(ref || '').trim();
    if (!value) return;
    if (value.startsWith('profile:')) {
      profileIds.push(value.slice('profile:'.length));
      return;
    }
    if (value.startsWith('recipient:')) {
      reportRecipientIds.push(value.slice('recipient:'.length));
      return;
    }
    if (isValidEmail(value)) {
      recipientEmails.push(value.toLowerCase());
      return;
    }
    // Compatibilidade com telas antigas que ainda enviam UUID puro de report_recipients.
    reportRecipientIds.push(value);
  });

  return {
    profileIds: [...new Set(profileIds)],
    reportRecipientIds: [...new Set(reportRecipientIds)],
    recipientEmails: [...new Set(recipientEmails)],
  };
}

export async function listReportRecipients() {
  const [profilesResult, recipientsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,name,email,role,cell,managed_cells,active')
      .in('role', ['admin', 'manager'])
      .eq('active', true)
      .order('name'),
    supabase
      .from('report_recipients')
      .select('id,name,email,role_label,recipient_group,cell_filter,active')
      .eq('active', true)
      .order('name'),
  ]);

  if (profilesResult.error) throw new Error(`Não foi possível consultar a aba Gestores/Usuários: ${profilesResult.error.message}`);

  const profileRecipients = (profilesResult.data || []).map(normalizeProfileRecipient);
  let legacyRecipients = [];
  let warning = '';

  if (recipientsResult.error) {
    if (isAiSchemaUnavailable(recipientsResult.error)) {
      warning = 'Fonte oficial ativa: aba Usuários/Gestores. O cadastro legado da IA não foi encontrado e foi ignorado.';
    } else {
      warning = `Fonte oficial ativa: aba Usuários/Gestores. Cadastro legado da IA ignorado: ${recipientsResult.error.message}`;
    }
  } else {
    legacyRecipients = (recipientsResult.data || []).map(normalizeLegacyRecipient);
  }

  return { data: dedupeRecipients([...profileRecipients, ...legacyRecipients]), warning };
}

// Mantido apenas para compatibilidade com instalações antigas. A tela nova não usa mais este cadastro.
export async function saveReportRecipient(recipient) {
  const payload = {
    name: recipient.name.trim(),
    email: recipient.email.trim().toLowerCase(),
    role_label: recipient.roleLabel || null,
    recipient_group: recipient.recipientGroup || 'manager',
    cell_filter: recipient.cellFilter || [],
    active: recipient.active !== false,
  };
  const query = recipient.id
    ? supabase.from('report_recipients').update(payload).eq('id', recipient.id)
    : supabase.from('report_recipients').insert(payload);
  const { data, error } = await query.select().single();
  if (error) {
    if (error.code === 'PGRST116' || error.message?.includes('single') || error.message?.includes('no rows')) {
      throw new Error('Acesso negado: apenas administradores ou gestores podem salvar destinatários (bloqueado por RLS).');
    }
    throw new Error(error.message);
  }
  return data;
}

// Mantido apenas para compatibilidade com instalações antigas. A tela nova não exclui gestores daqui.
export async function deleteReportRecipient(id) {
  const cleanId = String(id || '').replace(/^recipient:/, '');
  const { data, error } = await supabase
    .from('report_recipients')
    .delete()
    .eq('id', cleanId)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('Acesso negado ou destinatário não encontrado (bloqueado por RLS).');
  }
}

export async function listEmailLogs(limit = 100) {
  const { data, error } = await supabase.from('report_email_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!error) return { data: data || [], warning: '' };
  if (isAiSchemaUnavailable(error)) return { data: [], warning: 'Os envios serão auditados após publicar a migração 013.' };
  throw error;
}

async function getFunctionErrorMessage(error, fallback) {
  const response = error?.context;
  if (!response) return error?.message || fallback;
  try {
    const payload = await (response.clone?.() || response).json();
    return payload?.error || payload?.message || error?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
}

export async function sendReportEmail({ reportJobId, recipientIds = [], recipientProfileIds = [], recipientEmails = [], templateCode, subject, message }) {
  const refs = splitRecipientRefs(recipientIds);
  const profileIds = [...new Set([...refs.profileIds, ...toArray(recipientProfileIds)])];
  const reportRecipientIds = [...new Set(refs.reportRecipientIds)];
  const emails = [...new Set([...refs.recipientEmails, ...toArray(recipientEmails).map((email) => String(email).trim().toLowerCase()).filter(isValidEmail)])];

  if (!profileIds.length && !reportRecipientIds.length && !emails.length) throw new Error('Selecione pelo menos um destinatário.');

  const { data, error } = await supabase.functions.invoke('send-report-email', {
    body: { reportJobId, recipientIds: reportRecipientIds, recipientProfileIds: profileIds, recipientEmails: emails, templateCode, subject, message },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error, 'O serviço de e-mail não respondeu.'));
  if (!data?.success) throw new Error(data?.error || data?.message || 'O envio não foi concluído.');
  return data;
}

export async function sendReportEmailSmart({ directRecipients = [], ...payload }) {
  const directEmails = toArray(directRecipients)
    .map((recipient) => String(recipient?.email || '').trim().toLowerCase())
    .filter(isValidEmail);

  return sendReportEmail({
    ...payload,
    recipientEmails: [...toArray(payload.recipientEmails), ...directEmails],
  });
}

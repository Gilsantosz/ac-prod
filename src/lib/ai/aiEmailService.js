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

function mapScheduledReportType(type) {
  const map = {
    oee: 'oee',
    production_summary: 'daily_production',
    daily_production: 'daily_production',
    shift_closure: 'shift_closure',
    cell_performance: 'daily_production',
    lot_traceability: 'traceability_pending',
    occurrences: 'daily_production',
    executive: 'executive_summary',
    executive_summary: 'executive_summary',
    traceability_pending: 'traceability_pending',
    lots_delayed: 'lots_delayed',
    packaging_pending: 'packaging_pending',
    shipping_pending: 'shipping_pending',
  };
  return map[type] || 'daily_production';
}

function normalizeScheduleCells(filters = {}) {
  if (Array.isArray(filters.cells)) return filters.cells.filter(Boolean);
  if (Array.isArray(filters.cell)) return filters.cell.filter(Boolean);
  if (typeof filters.cell === 'string' && filters.cell && filters.cell !== 'all') return [filters.cell];
  return [];
}

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function frequencyForScheduledFallback(filters = {}, now = new Date()) {
  const requestedDate = filters.endDate || filters.startDate;
  if (!requestedDate) return 'weekly';
  if (requestedDate === localIso(addDays(now, -1))) return 'daily';
  return 'weekly';
}

function isProviderConfigError(message = '') {
  return /provedor de e-mail não configurado|resend_api_key|report_from_email|email_provider_not_configured/i.test(String(message));
}

function normalizeProfileRecipient(profile) {
  const roleLabel = profile.role === 'admin' 
    ? 'Administrador' 
    : profile.role === 'manager' 
    ? 'Gestor' 
    : profile.role === 'supervisor' 
    ? 'Supervisor' 
    : 'Colaborador';
  return {
    id: `profile:${profile.id}`,
    profile_id: profile.id,
    recipient_id: null,
    source: 'profile',
    source_label: `Usuário ${roleLabel}`,
    name: profile.name || profile.email || 'Colaborador sem nome',
    email: String(profile.email || '').trim().toLowerCase(),
    role_label: roleLabel,
    recipient_group: ['admin', 'manager', 'supervisor'].includes(profile.role) ? 'manager' : 'other',
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
      .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
      .eq('active', true)
      .or(`role.in.(admin,manager,supervisor),report_delivery_enabled.eq.true`)
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

async function fetchLegacyRecipientEmails(reportRecipientIds = []) {
  if (!reportRecipientIds.length) return [];
  const { data, error } = await supabase
    .from('report_recipients')
    .select('email')
    .in('id', reportRecipientIds)
    .eq('active', true);
  if (error) return [];
  return [...new Set((data || []).map((row) => String(row.email || '').trim().toLowerCase()).filter(isValidEmail))];
}

async function fetchReportJob(reportJobId) {
  const { data, error } = await supabase
    .from('report_jobs')
    .select('id,title,report_type,format,filters,requested_by')
    .eq('id', reportJobId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Não foi possível recuperar o relatório para envio.');
  if (!data) throw new Error('Relatório não encontrado para envio.');
  return data;
}

async function insertOneOffSchedule(schedulePayload) {
  const { data, error } = await supabase
    .from('report_schedules')
    .insert(schedulePayload)
    .select()
    .single();

  if (!error) return data;

  if (schedulePayload.report_types && /report_types|schema cache|column/i.test(error.message || '')) {
    const { report_types: _reportTypes, ...legacyPayload } = schedulePayload;
    const retry = await supabase
      .from('report_schedules')
      .insert(legacyPayload)
      .select()
      .single();
    if (!retry.error) return retry.data;
    throw new Error(retry.error.message || 'Não foi possível preparar o envio pelo canal SMTP.');
  }

  throw new Error(error.message || 'Não foi possível preparar o envio pelo canal SMTP.');
}

async function deleteOneOffSchedule(scheduleId) {
  if (!scheduleId) return;
  try {
    await supabase.from('report_schedules').delete().eq('id', scheduleId);
  } catch {
    // O envio avulso permanece desativado se a limpeza falhar.
  }
}

async function sendReportEmailViaScheduledFallback({ reportJobId, profileIds, reportRecipientIds, emails, subject }) {
  const [job, legacyEmails] = await Promise.all([
    fetchReportJob(reportJobId),
    fetchLegacyRecipientEmails(reportRecipientIds),
  ]);
  const extraEmails = [...new Set([...emails, ...legacyEmails])];
  if (!profileIds.length && !extraEmails.length) throw new Error('Selecione pelo menos um destinatário.');

  const reportType = mapScheduledReportType(job.report_type);
  const now = new Date();
  const schedule = await insertOneOffSchedule({
    name: String(subject || job.title || 'Envio avulso IA').slice(0, 120),
    enabled: false,
    report_type: reportType,
    report_types: [reportType],
    format: 'email_html',
    cell_filter: normalizeScheduleCells(job.filters),
    stage_filter: [],
    recipient_profile_ids: profileIds,
    extra_emails: extraEmails,
    frequency: frequencyForScheduledFallback(job.filters, now),
    time_local: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`,
    timezone: 'America/Sao_Paulo',
    next_run_at: now.toISOString(),
    created_by: job.requested_by || null,
  });

  try {
    const { data, error } = await supabase.functions.invoke('send-scheduled-reports', {
      body: { scheduleId: schedule.id, test: true },
    });
    if (error) throw new Error(await getFunctionErrorMessage(error, 'O canal SMTP/Gmail não respondeu.'));
    const processed = Array.isArray(data?.processed) ? data.processed : [];
    const failed = processed.find((item) => item && item.success === false);
    if (!data?.success || failed) throw new Error(failed?.error || data?.error || 'O envio pelo canal SMTP/Gmail não foi concluído.');
    if (!processed.length) throw new Error('O canal SMTP/Gmail não encontrou o envio avulso preparado.');
    return {
      success: true,
      fallback: 'send-scheduled-reports',
      message: 'Relatório enviado pelo canal de e-mails automáticos.',
      processed,
    };
  } finally {
    await deleteOneOffSchedule(schedule.id);
  }
}

export async function sendReportEmail({ reportJobId, recipientIds = [], recipientProfileIds = [], recipientEmails = [], templateCode, subject, message }) {
  const refs = splitRecipientRefs(recipientIds);
  const profileIds = [...new Set([...refs.profileIds, ...toArray(recipientProfileIds)])];
  const reportRecipientIds = [...new Set(refs.reportRecipientIds)];
  const emails = [...new Set([...refs.recipientEmails, ...toArray(recipientEmails).map((email) => String(email).trim().toLowerCase()).filter(isValidEmail)])];

  if (!profileIds.length && !reportRecipientIds.length && !emails.length) throw new Error('Selecione pelo menos um destinatário.');

  const body = { reportJobId, recipientIds: reportRecipientIds, recipientProfileIds: profileIds, recipientEmails: emails, templateCode, subject, message };
  const { data, error } = await supabase.functions.invoke('send-report-email', { body });
  if (error) {
    const errorMessage = await getFunctionErrorMessage(error, 'O serviço de e-mail não respondeu.');
    if (isProviderConfigError(errorMessage)) {
      return sendReportEmailViaScheduledFallback({ reportJobId, profileIds, reportRecipientIds, emails, subject });
    }
    throw new Error(errorMessage);
  }
  if (!data?.success) {
    const errorMessage = data?.error || data?.message || 'O envio não foi concluído.';
    if (isProviderConfigError(errorMessage)) {
      return sendReportEmailViaScheduledFallback({ reportJobId, profileIds, reportRecipientIds, emails, subject });
    }
    throw new Error(errorMessage);
  }
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

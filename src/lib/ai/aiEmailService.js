import { supabase } from '@/lib/supabaseClient';
import { isAiSchemaUnavailable } from './aiAuditService';

export async function listReportRecipients() {
  const { data, error } = await supabase.from('report_recipients').select('*').order('name');
  if (!error) return { data: data || [], warning: '' };
  if (isAiSchemaUnavailable(error)) return { data: [], warning: 'Cadastre gestores após publicar a migração 013.' };
  throw error;
}

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

export async function deleteReportRecipient(id) {
  const { data, error } = await supabase
    .from('report_recipients')
    .delete()
    .eq('id', id)
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

export async function sendReportEmail({ reportJobId, recipientIds, templateCode, subject, message }) {
  if (!recipientIds?.length) throw new Error('Selecione pelo menos um destinatário.');
  const { data, error } = await supabase.functions.invoke('send-report-email', {
    body: { reportJobId, recipientIds, templateCode, subject, message },
  });
  if (error) throw new Error(error.message || 'O serviço de e-mail não respondeu.');
  if (!data?.success) throw new Error(data?.error || 'O envio não foi concluído.');
  return data;
}

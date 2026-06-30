import { supabase } from '@/lib/supabaseClient';
import { generateOperationalReport } from './aiReportService';
import { sendReportEmail } from './aiEmailService';
import { parseIntent } from './aiIntentParser';
import { executeAiAction } from './aiActionExecutor';

function periodLabel(filters) {
  if (!filters?.startDate || !filters?.endDate) return 'período não especificado';
  return filters.startDate === filters.endDate
    ? filters.startDate.split('-').reverse().join('/')
    : `${filters.startDate.split('-').reverse().join('/')} a ${filters.endDate.split('-').reverse().join('/')}`;
}

async function findRegisteredManager(name) {
  const clean = String(name || '').trim().replace(/[%_]/g, '');
  if (!clean) throw new Error('Nome do gestor inválido.');
  const { data, error } = await supabase.from('profiles').select('id, name, email, role').eq('active', true).in('role', ['admin', 'manager']).ilike('name', `%${clean}%`).limit(1);
  if (error || !data?.length) {
    const { data: recs, error: recsError } = await supabase.from('report_recipients').select('id, name, email').eq('active', true).eq('recipient_group', 'manager').ilike('name', `%${clean}%`).limit(1);
    if (recsError || !recs?.length) throw new Error(`Gestor “${name}” não cadastrado ou inativo.`);
    return { id: recs[0].id, name: recs[0].name, email: recs[0].email, source: 'recipient' };
  }
  return { id: data[0].id, name: data[0].name, email: data[0].email, role: data[0].role, source: 'profile' };
}

async function ensureReportRecipient(manager) {
  if (manager.source === 'recipient') return manager.id;
  const { data, error } = await supabase.from('report_recipients').select('id').eq('email', manager.email).eq('recipient_group', 'manager').maybeSingle();
  if (!error && data?.id) return data.id;
  const { data: inserted, error: insertError } = await supabase.from('report_recipients').insert({
    profile_id: manager.id,
    name: manager.name,
    email: manager.email,
    recipient_group: 'manager',
    role_label: manager.role === 'admin' ? 'Administrador Industrial' : 'Gestor de Área',
    active: true,
  }).select('id').single();
  if (insertError) throw new Error(`Falha ao registrar destinatário: ${insertError.message}`);
  return inserted.id;
}

export function parseOperationalCommand(prompt, options = {}) {
  const parsed = parseIntent(prompt, options);
  if (parsed.action !== 'send_report_email') return null;
  
  const formatVal = parsed.format === 'pdf' && !/\bpdf\b/i.test(prompt) ? 'csv' : parsed.format;

  return {
    ...parsed,
    recipientName: parsed.recipients?.[0] || '',
    format: formatVal,
  };
}

export async function executeOperationalCommand(prompt, { user, dependencies = {} } = {}) {
  const clock = dependencies.clock || (() => new Date());
  const now = clock();
  const command = parseOperationalCommand(prompt, { now });
  
  if (!command) {
    throw new Error('Comando operacional inválido.');
  }

  if (user?.role === 'operator') {
    throw new Error('Seu perfil pode consultar relatórios, mas não possui permissão para enviá-los por e-mail.');
  }

  if (!command.recipientName) {
    throw new Error('Informe o nome do gestor após a palavra “para”.');
  }

  const findManager = dependencies.findManager || findRegisteredManager;
  const ensureRecipient = dependencies.ensureRecipient || ensureReportRecipient;
  const generateReport = dependencies.generateReport || generateOperationalReport;
  const sendEmail = dependencies.sendEmail || sendReportEmail;

  const manager = await findManager(command.recipientName);
  const recipientId = await ensureRecipient(manager);

  const report = await generateReport({
    user,
    reportType: command.reportType,
    format: command.format,
    title: `Relatório OEE - ${periodLabel(command.filters)}`,
    filters: command.filters,
    options: { requestedByAi: true, recipientName: manager.name },
  });

  if (!report.context?.entries?.length) {
    throw new Error(`Não há apontamentos no período ${periodLabel(command.filters)}. O e-mail não foi enviado.`);
  }

  if (!report.jobId) {
    throw new Error('O relatório foi calculado, mas não pôde ser registrado para envio auditado.');
  }

  await sendEmail({
    reportJobId: report.jobId,
    recipientIds: [recipientId],
    templateCode: command.reportType === 'cell_performance' ? 'cell-performance' : 'manager-summary',
    subject: `[Leo Flow] ${report.title}`,
    message: `Segue o relatório solicitado para o período ${periodLabel(command.filters)}.`,
  });

  return {
    content: `${report.title} enviado para ${manager.name} (${manager.email}). O envio ficou registrado na auditoria da IA Operacional.`,
    context: { command, reportJobId: report.jobId, recipientName: manager.name },
  };
}

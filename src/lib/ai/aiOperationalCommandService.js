import { supabase } from '@/lib/supabaseClient';
import { normalizeText } from '@/lib/assistant/assistantEngine';
import { generateOperationalReport } from './aiReportService';
import { sendReportEmail } from './aiEmailService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEND_VERBS = /\b(envie|enviar|mande|mandar|encaminhe|encaminhar|dispare|disparar)\b/;
const REPORT_TERMS = /\b(relatorio|oee|resumo executivo|producao|ocorrencias|rastreabilidade)\b/;

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

function brazilianDate(value) {
  const match = String(value || '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return '';
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(date.getTime()) ? '' : localIso(date);
}

function resolvePeriod(text, now = new Date(), reportType = 'production_summary') {
  const normalized = normalizeText(text);
  const explicitRange = normalized.match(/(?:de|entre)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(?:a|e|ate)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
  if (explicitRange) {
    const startDate = brazilianDate(explicitRange[1]);
    const endDate = brazilianDate(explicitRange[2]);
    if (startDate && endDate) return { startDate, endDate };
  }

  if (/\bontem\b/.test(normalized)) {
    const yesterday = localIso(addDays(now, -1));
    return { startDate: yesterday, endDate: yesterday };
  }
  if (/\bhoje\b/.test(normalized)) {
    const today = localIso(now);
    return { startDate: today, endDate: today };
  }
  const daysMatch = normalized.match(/(?:ultimos?|ha)\s+(\d{1,3})\s+dias?/);
  if (daysMatch) {
    const days = Math.max(1, Math.min(366, Number(daysMatch[1])));
    return { startDate: localIso(addDays(now, -(days - 1))), endDate: localIso(now) };
  }
  if (/\b(esta|nesta)\s+semana\b/.test(normalized)) {
    const weekday = now.getDay() || 7;
    return { startDate: localIso(addDays(now, 1 - weekday)), endDate: localIso(now) };
  }
  if (/\b(este|neste)\s+mes\b/.test(normalized)) {
    return { startDate: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localIso(now) };
  }

  const endDate = localIso(now);
  return reportType === 'oee'
    ? { startDate: endDate, endDate }
    : { startDate: localIso(addDays(now, -6)), endDate };
}

function reportTypeFromText(normalized) {
  if (/\boee\b/.test(normalized)) return 'oee';
  if (/\bocorrenc/.test(normalized)) return 'occurrences';
  if (/\brastreabilidade|\blote/.test(normalized)) return 'lot_traceability';
  if (/\bexecutivo/.test(normalized)) return 'executive';
  if (/\bcelula|desempenho/.test(normalized)) return 'cell_performance';
  return 'production_summary';
}

function recipientFromText(text) {
  const match = String(text || '').match(/\bpara\s+(?:o\s+|a\s+)?(?:gestor(?:a)?|gerente|administrador(?:a)?)?\s*([\p{L}][\p{L}\s.'-]{1,80}?)(?=\s+(?:por|via)\s+e-?mail|[,.!?]|$)/iu);
  return String(match?.[1] || '').trim().replace(/\s+/g, ' ');
}

export function parseOperationalCommand(prompt, options = {}) {
  const text = String(prompt || '').trim();
  const normalized = normalizeText(text);
  if (!SEND_VERBS.test(normalized) || !REPORT_TERMS.test(normalized)) return null;
  const reportType = reportTypeFromText(normalized);
  return {
    action: 'send_report_email',
    reportType,
    recipientName: recipientFromText(text),
    filters: resolvePeriod(text, options.now || new Date(), reportType),
    format: 'csv',
  };
}

function normalizeName(value) {
  return normalizeText(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function selectSingleManager(candidates, requestedName) {
  const requested = normalizeName(requestedName);
  const byEmail = new Map();
  candidates.forEach((candidate) => {
    if (candidate.email && !byEmail.has(candidate.email.toLowerCase())) byEmail.set(candidate.email.toLowerCase(), candidate);
  });
  const unique = [...byEmail.values()];
  const exact = unique.filter((candidate) => normalizeName(candidate.name) === requested);
  const matches = exact.length ? exact : unique.filter((candidate) => normalizeName(candidate.name).includes(requested));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`Não encontrei o gestor “${requestedName}” entre os usuários ou destinatários ativos do sistema.`);
  throw new Error(`Encontrei mais de um gestor com esse nome: ${matches.map((item) => item.name).join(', ')}. Informe o nome completo.`);
}

export async function findRegisteredManager(name) {
  const cleanName = String(name || '').replace(/[%_]/g, '').trim();
  if (cleanName.length < 2) throw new Error('Informe o nome do gestor que deve receber o relatório.');
  const [recipientsResult, profilesResult] = await Promise.all([
    supabase.from('report_recipients').select('id,name,email,role_label,active').eq('active', true).ilike('name', `%${cleanName}%`).limit(20),
    supabase.from('profiles').select('id,name,email,role,active').eq('active', true).in('role', ['admin', 'manager']).ilike('name', `%${cleanName}%`).limit(20),
  ]);
  if (recipientsResult.error) throw new Error(`Não foi possível consultar os destinatários: ${recipientsResult.error.message}`);
  if (profilesResult.error) throw new Error(`Não foi possível consultar os gestores: ${profilesResult.error.message}`);
  const candidates = [
    ...(recipientsResult.data || []).map((item) => ({ ...item, recipientId: item.id, source: 'recipient' })),
    ...(profilesResult.data || []).map((item) => ({ ...item, profileId: item.id, source: 'profile' })),
  ].filter((item) => EMAIL_PATTERN.test(String(item.email || '')));
  return selectSingleManager(candidates, cleanName);
}

async function ensureReportRecipient(manager) {
  if (manager.recipientId) return manager.recipientId;
  const normalizedEmail = manager.email.trim().toLowerCase();
  const { data: existing, error: existingError } = await supabase
    .from('report_recipients')
    .select('id,active')
    .eq('email', normalizedEmail)
    .eq('recipient_group', 'manager')
    .maybeSingle();
  if (existingError) throw new Error(`Não foi possível validar o destinatário: ${existingError.message}`);
  if (existing && !existing.active) throw new Error(`O envio para ${manager.name} está desativado no cadastro de gestores da IA.`);
  if (existing?.id) return existing.id;
  const { data, error } = await supabase.from('report_recipients').insert({
    name: manager.name,
    email: normalizedEmail,
    role_label: manager.role === 'admin' ? 'Administrador' : 'Gestor',
    recipient_group: 'manager',
    active: true,
  }).select('id').single();
  if (error) throw new Error(`Não foi possível autorizar o gestor para relatórios: ${error.message}`);
  return data.id;
}

function canSendReports(user) {
  return user?.role === 'admin' || user?.role === 'manager';
}

function periodLabel(filters) {
  return filters.startDate === filters.endDate
    ? filters.startDate.split('-').reverse().join('/')
    : `${filters.startDate.split('-').reverse().join('/')} a ${filters.endDate.split('-').reverse().join('/')}`;
}

function reportTitle(command) {
  const names = {
    oee: 'Relatório OEE',
    occurrences: 'Relatório de Ocorrências',
    lot_traceability: 'Relatório de Rastreabilidade',
    executive: 'Resumo Executivo',
    cell_performance: 'Desempenho por Célula',
    production_summary: 'Resumo de Produção',
  };
  return `${names[command.reportType] || 'Relatório Industrial'} - ${periodLabel(command.filters)}`;
}

function emailMessage(report, command) {
  const oee = report.analysis?.oee;
  if (command.reportType === 'oee' && oee) {
    return `Relatório OEE do período ${periodLabel(command.filters)}. OEE global: ${oee.oee.toFixed(1)}%. Disponibilidade: ${oee.availability.toFixed(1)}%. Performance: ${oee.performance.toFixed(1)}%. Qualidade: ${oee.quality.toFixed(1)}%.`;
  }
  return `Segue o relatório solicitado para o período ${periodLabel(command.filters)}.`;
}

export async function executeOperationalCommand(prompt, { user, dependencies = {} } = {}) {
  const command = parseOperationalCommand(prompt, dependencies.clock ? { now: dependencies.clock() } : {});
  if (!command) return null;
  if (!canSendReports(user)) throw new Error('Seu perfil pode consultar relatórios, mas não possui permissão para enviá-los por e-mail.');
  if (!command.recipientName) throw new Error('Informe o nome do gestor após a palavra “para”.');

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
    title: reportTitle(command),
    filters: command.filters,
    options: { requestedByAi: true, recipientName: manager.name },
  });
  if (!report.context?.entries?.length) throw new Error(`Não há apontamentos no período ${periodLabel(command.filters)}. O e-mail não foi enviado.`);
  if (!report.jobId) throw new Error('O relatório foi calculado, mas não pôde ser registrado para envio auditado.');
  await sendEmail({
    reportJobId: report.jobId,
    recipientIds: [recipientId],
    templateCode: command.reportType === 'cell_performance' ? 'cell-performance' : 'manager-summary',
    subject: `[Leo Flow] ${report.title}`,
    message: emailMessage(report, command),
  });
  return {
    content: `${report.title} enviado para ${manager.name} (${manager.email}). O envio ficou registrado na auditoria da IA Operacional.`,
    context: { command, reportJobId: report.jobId, recipientName: manager.name },
  };
}

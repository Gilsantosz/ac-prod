import { supabase } from '@/lib/supabaseClient';
import { fetchAiContext, normalizeAiFilters } from './aiContextService';
import { analyzeProductionContext } from './aiInsightService';
import { isAiSchemaUnavailable, recordAiEvent, recordAiRequest } from './aiAuditService';

export const REPORT_TYPES = [
  { value: 'production_summary', label: 'Resumo de Produção' },
  { value: 'cell_performance', label: 'Desempenho por Célula' },
  { value: 'lot_traceability', label: 'Rastreabilidade de Lotes' },
  { value: 'occurrences', label: 'Ocorrências e Paradas' },
  { value: 'executive', label: 'Resumo Executivo' },
];

export async function generateOperationalReport({ user, reportType, format, title, filters, options = {} }) {
  const started = performance.now();
  const traceId = crypto.randomUUID();
  const context = await fetchAiContext(filters, user);
  const analysis = analyzeProductionContext(context);
  const resolvedTitle = title?.trim() || REPORT_TYPES.find((item) => item.value === reportType)?.label || 'Relatório Industrial';
  const report = {
    id: crypto.randomUUID(),
    traceId,
    title: resolvedTitle,
    reportType,
    format,
    filters: context.filters,
    options,
    context,
    analysis,
    generatedAt: new Date().toISOString(),
    generatedBy: user?.name || user?.email || 'Usuário AC.Prod',
  };

  const { data: job, error } = await supabase.from('report_jobs').insert({
    requested_by: user?.id,
    title: report.title,
    report_type: reportType,
    format,
    filters: context.filters,
    options,
    snapshot: { analysis, counts: { entries: context.entries.length, occurrences: context.occurrences.length, lots: context.lots.length } },
    status: 'completed',
    trace_id: traceId,
    completed_at: new Date().toISOString(),
  }).select().maybeSingle();

  const persistenceWarning = error && !isAiSchemaUnavailable(error) ? error.message : (error ? 'Histórico dedicado pendente da migração 013.' : '');
  report.jobId = job?.id || null;
  report.persistenceWarning = persistenceWarning;

  await Promise.all([
    recordAiRequest({
      user,
      requestType: 'report',
      prompt: `Gerar ${report.title}`,
      intent: reportType,
      filters: context.filters,
      responseSummary: `${context.entries.length} apontamentos, ${context.occurrences.length} ocorrências e ${context.lots.length} lotes.`,
      sourceTables: context.sources,
      traceId,
      durationMs: Math.round(performance.now() - started),
    }),
    recordAiEvent({ user, traceId, event: 'report.generated', entity: 'report_job', entityId: job?.id, message: report.title, metadata: { reportType, format, filters: context.filters } }),
  ]);

  return report;
}

export async function listReportJobs(limit = 100) {
  const { data, error } = await supabase.from('report_jobs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!error) return { data: data || [], warning: '' };
  if (isAiSchemaUnavailable(error)) return { data: [], warning: 'Publique a migração 013 para armazenar o histórico de relatórios.' };
  throw error;
}

export async function listScheduledReports() {
  const { data, error } = await supabase.from('scheduled_reports').select('*').order('created_at', { ascending: false });
  if (!error) return { data: data || [], warning: '' };
  if (isAiSchemaUnavailable(error)) return { data: [], warning: 'Agendamentos estarão disponíveis após publicar a migração 013.' };
  throw error;
}

export async function createScheduledReport(payload, user) {
  const { data, error } = await supabase.functions.invoke('schedule-report-job', { body: { ...payload, filters: normalizeAiFilters(payload.filters), requestedBy: user?.id } });
  if (error) throw new Error(error.message || 'Não foi possível criar o agendamento.');
  return data;
}


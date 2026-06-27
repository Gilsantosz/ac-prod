import { supabase } from '@/lib/supabaseClient';
import { fetchAiContext, normalizeAiFilters } from './aiContextService';
import { analyzeProductionContext } from './aiInsightService';
import { isAiSchemaUnavailable, recordAiEvent, recordAiRequest } from './aiAuditService';

export const REPORT_TYPES = [
  { value: 'oee', label: 'OEE - Eficiência Global' },
  { value: 'production_summary', label: 'Resumo de Produção' },
  { value: 'cell_performance', label: 'Desempenho por Célula' },
  { value: 'lot_traceability', label: 'Rastreabilidade de Lotes' },
  { value: 'occurrences', label: 'Ocorrências e Paradas' },
  { value: 'executive', label: 'Resumo Executivo' },
];

export function calculateOeeSummary(entries = []) {
  const sum = (key) => entries.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
  const produced = sum('produced');
  const target = sum('target');
  const scrap = sum('scrap');
  const downtime = sum('downtime');
  const shifts = new Map();
  entries.forEach((entry) => {
    const key = `${entry.date || ''}|${entry.cell || ''}|${entry.shift || ''}`;
    if (!shifts.has(key)) shifts.set(key, Math.max(1, Number(entry.hours) || 8) * 60);
  });
  const planned = [...shifts.values()].reduce((total, minutes) => total + minutes, 0);
  const availability = planned > 0 ? Math.max(planned - downtime, 0) / planned : 0;
  const performance = target > 0 ? Math.min(produced / target, 1.5) : 0;
  const quality = produced > 0 ? Math.max(produced - scrap, 0) / produced : 0;
  return {
    oee: availability * performance * quality * 100,
    availability: availability * 100,
    performance: performance * 100,
    quality: quality * 100,
    plannedMinutes: planned,
    downtimeMinutes: downtime,
    produced,
    target,
    scrap,
  };
}

export async function generateOperationalReport({ user, reportType, format, title, filters, options = {} }) {
  const started = performance.now();
  const traceId = crypto.randomUUID();
  const context = await fetchAiContext(filters, user);
  const analysis = analyzeProductionContext(context);
  if (reportType === 'oee') analysis.oee = calculateOeeSummary(context.entries);
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
    generatedBy: user?.name || user?.email || 'Usuário Leo Flow',
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

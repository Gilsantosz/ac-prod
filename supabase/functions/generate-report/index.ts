import { aggregate, corsHeaders, fetchOperationalData, json, requireAiUser } from '../_shared/aiOperations.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { admin, user, profile } = await requireAiUser(req);
    const body = await req.json();
    const traceId = crypto.randomUUID();
    const { data: job, error: jobError } = await admin.from('report_jobs').insert({ requested_by: user.id, title: body.title || 'Relatório Industrial', report_type: body.reportType || 'production_summary', format: body.format || 'pdf', filters: body.filters || {}, options: body.options || {}, status: 'processing', trace_id: traceId, started_at: new Date().toISOString() }).select().single();
    if (jobError) throw jobError;
    try {
      const context = await fetchOperationalData(admin, profile, body.filters);
      const summary = aggregate(context.entries, context.occurrences, context.lots);
      await admin.from('report_jobs').update({ status: 'completed', filters: context.filters, snapshot: { summary, entries: context.entries, occurrences: context.occurrences, lots: context.lots }, completed_at: new Date().toISOString() }).eq('id', job.id);
      await admin.from('ai_system_logs').insert({ user_id: user.id, trace_id: traceId, event: 'report.generated.server', entity: 'report_job', entity_id: job.id, metadata: { report_type: body.reportType, format: body.format } });
      return json({ success: true, jobId: job.id, traceId, summary });
    } catch (error) {
      await admin.from('report_jobs').update({ status: 'failed', error_message: error.message, completed_at: new Date().toISOString() }).eq('id', job.id);
      throw error;
    }
  } catch (error) {
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});


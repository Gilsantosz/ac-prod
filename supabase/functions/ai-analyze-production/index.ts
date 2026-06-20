import { aggregate, corsHeaders, fetchOperationalData, json, requireAiUser } from '../_shared/aiOperations.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { admin, user, profile } = await requireAiUser(req);
    const body = await req.json().catch(() => ({}));
    const context = await fetchOperationalData(admin, profile, body.filters || {});
    const summary = aggregate(context.entries, context.occurrences, context.lots);
    const recommendations: string[] = [];
    if (summary.efficiency < 80 && summary.target > 0) recommendations.push('Revisar as células abaixo da meta e suas principais paradas.');
    if (summary.scrapRate > 3) recommendations.push('Investigar setup, material e inspeção nos registros com refugo.');
    if (summary.blockedLots > 0) recommendations.push('Tratar os lotes bloqueados por ordem de antiguidade.');
    if (!recommendations.length) recommendations.push('Manter o acompanhamento e comparar o próximo período com esta linha de base.');
    const traceId = crypto.randomUUID();
    await admin.from('ai_requests').insert({ user_id: user.id, request_type: 'insight', prompt: body.question || 'Análise operacional', normalized_intent: 'production_analysis', filters: context.filters, response_summary: JSON.stringify({ summary, recommendations }), source_tables: ['production_entries','occurrences','production_lots'], trace_id: traceId, completed_at: new Date().toISOString() });
    return json({ success: true, traceId, filters: context.filters, summary, recommendations });
  } catch (error) {
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});


import { corsHeaders, json, requireAiUser } from '../_shared/aiOperations.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { admin, user } = await requireAiUser(req, true);
    const body = await req.json();
    const next = new Date();
    const [hour, minute] = String(body.timeLocal || '07:00').split(':').map(Number);
    next.setHours(hour || 7, minute || 0, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    let templateId = body.templateId || null;
    if (!templateId && body.templateCode) {
      const { data: template } = await admin.from('report_templates').select('id').eq('code', body.templateCode).maybeSingle();
      templateId = template?.id || null;
    }
    const { data, error } = await admin.from('scheduled_reports').insert({ name: body.name, report_type: body.reportType, format: body.format, filters: body.filters || {}, options: body.options || {}, recipient_ids: body.recipientIds || [], template_id: templateId, frequency: body.frequency || 'daily', time_local: body.timeLocal || '07:00', timezone: body.timezone || 'America/Sao_Paulo', next_run_at: next.toISOString(), created_by: user.id }).select().single();
    if (error) throw error;
    await admin.from('ai_system_logs').insert({ user_id: user.id, event: 'report.scheduled', entity: 'scheduled_report', entity_id: data.id, metadata: { frequency: data.frequency } });
    return json({ success: true, schedule: data });
  } catch (error) {
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});

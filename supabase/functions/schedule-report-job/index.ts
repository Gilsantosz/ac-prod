import { corsHeaders, json, requireAiUser } from '../_shared/aiOperations.ts';

function mapReportTypeToScheduleType(aiType: string): string {
  const type = String(aiType || '').toLowerCase().trim();
  if (type === 'production_summary' || type === 'daily_production' || type === 'cell_performance' || type === 'occurrences') return 'daily_production';
  if (type === 'shift_closure') return 'shift_closure';
  if (type === 'oee') return 'oee';
  if (type === 'traceability_pending' || type === 'lot_traceability') return 'traceability_pending';
  if (type === 'lots_delayed') return 'lots_delayed';
  if (type === 'packaging_pending') return 'packaging_pending';
  if (type === 'shipping_pending') return 'shipping_pending';
  if (type === 'executive' || type === 'executive_summary') return 'executive_summary';
  return 'daily_production';
}

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
    
    const scheduleId = crypto.randomUUID();
    
    // Resolve report_recipients to profiles and extra emails
    const recipientIds = body.recipientIds || [];
    const recipientProfileIds: string[] = [];
    const extraEmails: string[] = [];
    
    if (recipientIds.length > 0) {
      const { data: recs } = await admin.from('report_recipients').select('email').in('id', recipientIds);
      if (recs && recs.length > 0) {
        const emails = recs.map((r: any) => r.email.toLowerCase().trim());
        const { data: profs } = await admin.from('profiles').select('id, email').in('email', emails);
        const profileMap = new Map();
        if (profs) {
          profs.forEach((p: any) => profileMap.set(p.email.toLowerCase().trim(), p.id));
        }
        emails.forEach((email: string) => {
          if (profileMap.has(email)) {
            recipientProfileIds.push(profileMap.get(email));
          } else {
            extraEmails.push(email);
          }
        });
      }
    }
    
    if (Array.isArray(body.extraEmails)) {
      body.extraEmails.forEach((email: string) => {
        const clean = String(email || '').trim().toLowerCase();
        if (clean && !extraEmails.includes(clean)) extraEmails.push(clean);
      });
    }

    // 1. Insert into scheduled_reports (compatibility)
    const { data: scheduledReport, error: srError } = await admin.from('scheduled_reports').insert({
      id: scheduleId,
      name: body.name,
      report_type: body.reportType || 'production_summary',
      format: body.format || 'pdf',
      filters: body.filters || {},
      options: body.options || {},
      recipient_ids: recipientIds,
      template_id: templateId,
      frequency: body.frequency || 'daily',
      time_local: body.timeLocal || '07:00',
      timezone: body.timezone || 'America/Sao_Paulo',
      next_run_at: next.toISOString(),
      created_by: user.id
    }).select().single();
    
    if (srError) throw srError;

    // 2. Insert into report_schedules (processed by Edge Function send-scheduled-reports)
    const { error: rsError } = await admin.from('report_schedules').insert({
      id: scheduleId,
      name: body.name,
      enabled: body.enabled !== false,
      report_type: mapReportTypeToScheduleType(body.reportType),
      time_local: body.timeLocal ? `${body.timeLocal}:00` : '07:00:00',
      timezone: body.timezone || 'America/Sao_Paulo',
      frequency: body.frequency || 'daily',
      cell_filter: body.filters?.cells || body.cellFilter || [],
      stage_filter: body.filters?.stages || body.stageFilter || [],
      recipient_profile_ids: recipientProfileIds,
      extra_emails: extraEmails,
      format: body.format === 'html' || body.format === 'email_html' ? 'email_html' : body.format || 'email_html',
      next_run_at: next.toISOString(),
      created_by: user.id
    });
    
    if (rsError) {
      // Rollback scheduled_report
      await admin.from('scheduled_reports').delete().eq('id', scheduleId);
      throw rsError;
    }

    await admin.from('ai_system_logs').insert({
      user_id: user.id,
      event: 'report.scheduled',
      entity: 'scheduled_report',
      entity_id: scheduleId,
      metadata: { frequency: body.frequency, source: 'ai_copilot' }
    });
    
    return json({ success: true, schedule: scheduledReport });
  } catch (error) {
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});

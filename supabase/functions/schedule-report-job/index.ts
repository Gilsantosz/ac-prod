import { corsHeaders, json, requireAiUser } from '../_shared/aiOperations.ts';

function asArray(value: any): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function splitRefs(body: any) {
  const profileIds = new Set<string>(asArray(body.recipientProfileIds || body.profileIds));

  asArray(body.recipientIds).forEach((value) => {
    if (value.startsWith('profile:')) profileIds.add(value.slice('profile:'.length));
  });

  return { profileIds: [...profileIds] };
}

function mapReportType(type: string) {
  const map: Record<string, string> = {
    oee: 'oee',
    production_summary: 'daily_production',
    executive: 'executive_summary',
    lot_traceability: 'traceability_pending',
    cell_performance: 'daily_production',
    occurrences: 'daily_production',
    daily_production: 'daily_production',
    shift_closure: 'shift_closure',
    traceability_pending: 'traceability_pending',
    lots_delayed: 'lots_delayed',
    packaging_pending: 'packaging_pending',
    shipping_pending: 'shipping_pending',
    executive_summary: 'executive_summary',
  };
  return map[type] || 'daily_production';
}

function normalizeTime(value: string) {
  const clean = String(value || '07:00').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) return clean;
  if (/^\d{2}:\d{2}$/.test(clean)) return `${clean}:00`;
  return '07:00:00';
}

function nextRunAt(timeLocal: string, frequency: string) {
  const next = new Date();
  const [hour, minute] = timeLocal.split(':').map(Number);
  next.setHours(hour || 7, minute || 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  if (frequency === 'workdays') {
    while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { admin, user } = await requireAiUser(req, true);
    const body = await req.json();
    const refs = splitRefs(body);
    const recipientProfileIds = [...new Set(refs.profileIds)];

    if (!recipientProfileIds.length) throw new Error('RECIPIENT_REQUIRED');

    const { data: eligibleProfiles, error: profileError } = await admin
      .from('profiles')
      .select('id,role,active,report_delivery_enabled')
      .in('id', recipientProfileIds)
      .eq('active', true);
    if (profileError) throw profileError;
    const eligibleIds = (eligibleProfiles || [])
      .filter((profile: any) => ['admin', 'manager', 'supervisor'].includes(profile.role) || profile.report_delivery_enabled === true)
      .map((profile: any) => profile.id);
    if (!eligibleIds.length) throw new Error('RECIPIENT_REQUIRED');

    const reportType = mapReportType(body.reportType || body.report_type);
    const reportTypes = asArray(body.reportTypes || body.report_types).map(mapReportType);
    const timeLocal = normalizeTime(body.timeLocal || body.time_local);
    const frequency = ['daily', 'workdays', 'weekly', 'monthly'].includes(body.frequency) ? body.frequency : 'daily';
    const filters = body.filters || {};

    const payload = {
      name: String(body.name || 'Relatório IA Operacional').trim(),
      report_type: reportTypes[0] || reportType,
      report_types: reportTypes.length ? reportTypes : [reportType],
      format: ['pdf', 'xlsx', 'csv', 'email_html'].includes(body.format) ? body.format : 'email_html',
      cell_filter: Array.isArray(filters.cells) ? filters.cells : [],
      recipient_profile_ids: eligibleIds,
      extra_emails: [],
      frequency,
      time_local: timeLocal,
      timezone: body.timezone || 'America/Sao_Paulo',
      next_run_at: nextRunAt(timeLocal, frequency),
      enabled: body.enabled !== false,
      created_by: user.id,
    };

    const { data, error } = await admin.from('report_schedules').insert(payload).select().single();
    if (error) throw error;
    await admin.from('ai_system_logs').insert({ user_id: user.id, event: 'report.scheduled', entity: 'report_schedule', entity_id: data.id, metadata: { frequency: data.frequency, recipientProfiles: eligibleIds.length } });
    return json({ success: true, schedule: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'AUTH_REQUIRED' ? 401 : message === 'ACCESS_DENIED' ? 403 : message === 'RECIPIENT_REQUIRED' ? 422 : 500;
    return json({ success: false, error: message === 'RECIPIENT_REQUIRED' ? 'Selecione pelo menos um gestor previamente cadastrado e habilitado para relatórios.' : message }, status);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'Serviço de fechamento indisponível.' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let temporaryScheduleId: string | null = null;

  try {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, error: 'Autenticação necessária.' }, 401);

    const { data: authResult, error: authError } = await admin.auth.getUser(token);
    if (authError || !authResult.user) return json({ success: false, error: 'Sessão inválida ou expirada.' }, 401);

    const { data: caller } = await admin
      .from('profiles')
      .select('id, role, active, permissions')
      .eq('id', authResult.user.id)
      .maybeSingle();
    const allowed = caller?.active !== false && (
      ['admin', 'manager'].includes(caller?.role)
      || caller?.permissions?.send_reports === true
      || caller?.permissions?.manage_automations === true
    );
    if (!allowed) return json({ success: false, error: 'Sem permissão para enviar o fechamento produtivo.' }, 403);

    const body = await request.json().catch(() => ({}));
    const reportDate = String(body?.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
    if (!DATE_PATTERN.test(reportDate)) return json({ success: false, error: 'Data do fechamento inválida.' }, 422);

    const { data: recipients, error: recipientError } = await admin
      .from('profiles')
      .select('id, email')
      .eq('active', true)
      .eq('report_delivery_enabled', true)
      .in('role', ['admin', 'manager', 'supervisor']);
    if (recipientError) throw recipientError;

    const validRecipients = (recipients || []).filter((profile) => profile.email);
    if (!validRecipients.length) {
      return json({ success: true, sent: 0, failed: 0, recipients: [], warning: 'Nenhum gestor está marcado para receber relatórios em Usuários > Contas.' });
    }

    const now = new Date();
    const { data: schedule, error: scheduleError } = await admin
      .from('report_schedules')
      .insert({
        name: `Fechamento produtivo ${reportDate}`,
        enabled: false,
        report_type: 'shift_closure',
        report_types: ['shift_closure'],
        format: 'email_html',
        frequency: 'daily',
        time_local: now.toISOString().slice(11, 19),
        timezone: 'America/Sao_Paulo',
        period_mode: 'current_day',
        report_date: reportDate,
        source_page: 'daily_summary_manual',
        recipient_profile_ids: validRecipients.map((profile) => profile.id),
        extra_emails: [],
        created_by: caller.id,
      })
      .select('id')
      .single();
    if (scheduleError) throw scheduleError;
    temporaryScheduleId = schedule.id;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-scheduled-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ scheduleId: schedule.id, test: true }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success !== true) {
      throw new Error(result?.error || 'O serviço central de e-mail não concluiu o fechamento.');
    }

    const { data: deliveries, error: deliveryError } = await admin
      .from('report_deliveries')
      .select('recipient_email_snapshot,status,error_message')
      .eq('schedule_id', schedule.id);
    if (deliveryError) throw deliveryError;

    const sent = (deliveries || []).filter((delivery) => delivery.status === 'sent').length;
    const failed = (deliveries || []).filter((delivery) => delivery.status === 'failed').length;
    return json({
      success: sent > 0,
      sent,
      failed,
      recipients: (deliveries || []).map((delivery) => delivery.recipient_email_snapshot),
      error: sent === 0 ? (deliveries?.[0]?.error_message || 'Nenhum e-mail foi enviado.') : undefined,
    }, sent > 0 ? 200 : 502);
  } catch (error) {
    console.error('[sendDailyClosure] Falha:', error instanceof Error ? error.message : error);
    return json({ success: false, error: error instanceof Error ? error.message : 'Falha ao enviar o fechamento.' }, 500);
  } finally {
    if (temporaryScheduleId) {
      await admin.from('report_schedules').delete().eq('id', temporaryScheduleId);
    }
  }
});

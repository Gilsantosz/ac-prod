import { aggregate, corsHeaders, fetchOperationalData, json, requireAiUser } from '../_shared/aiOperations.ts';
import { renderEmailTemplate } from '../_shared/emailTemplates.ts';

function csvAttachment(entries: any[]) {
  const columns = ['order_number','lot_code','load_number','customer_trade_name','customer_legal_name','product_name','route_name','finalization_date','pallet_number','cell','process_step','produced','approved_quantity','rejected_quantity','pending_quantity','scrap','downtime','approval_status'];
  const escape = (value: any) => `"${String(value ?? '').replaceAll('"','""')}"`;
  const content = '\uFEFF' + [columns, ...entries.map((row) => columns.map((column) => row[column] ?? ''))].map((row) => row.map(escape).join(';')).join('\n');
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let admin: any;
  let user: any;
  try {
    const auth = await requireAiUser(req, true);
    ({ admin, user } = auth);
    const body = await req.json();
    if (!body.reportJobId) throw new Error('Gere e registre o relatório antes do envio.');
    const [{ data: job, error: jobError }, { data: recipients, error: recipientsError }] = await Promise.all([
      admin.from('report_jobs').select('*').eq('id', body.reportJobId).single(),
      admin.from('report_recipients').select('*').in('id', body.recipientIds || []).eq('active', true),
    ]);
    if (jobError || !job) throw new Error('Relatório não encontrado.');
    if (recipientsError || !recipients?.length) throw new Error('Nenhum destinatário válido.');
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('REPORT_FROM_EMAIL');
    if (!apiKey || !from) throw new Error('Provedor de e-mail não configurado. Defina RESEND_API_KEY e REPORT_FROM_EMAIL.');
    const freshContext = await fetchOperationalData(admin, auth.profile, job.filters || {});
    const summary = aggregate(freshContext.entries, freshContext.occurrences, freshContext.lots);
    const html = renderEmailTemplate(body.templateCode || 'manager-summary', job.title, summary, body.message || 'Segue o relatório industrial solicitado.');
    const subject = String(body.subject || `[AC.Prod] ${job.title}`).slice(0, 180);
    const results = [];
    for (const recipient of recipients) {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [recipient.email], subject, html, attachments: [{ filename: `${job.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.csv`, content: csvAttachment(freshContext.entries) }] }) });
      const providerResult = await response.json().catch(() => ({}));
      const success = response.ok;
      await admin.from('report_email_logs').insert({ report_job_id: job.id, recipient_id: recipient.id, recipient_email: recipient.email, subject, provider: 'resend', provider_message_id: providerResult.id || null, status: success ? 'sent' : 'failed', error_message: success ? null : (providerResult.message || `HTTP ${response.status}`), sent_by: user.id, sent_at: success ? new Date().toISOString() : null });
      results.push({ email: recipient.email, success });
    }
    await admin.from('ai_system_logs').insert({ user_id: user.id, trace_id: job.trace_id, event: 'report.email.sent', entity: 'report_job', entity_id: job.id, metadata: { recipients: results.length, success: results.filter((item) => item.success).length } });
    return json({ success: results.some((item) => item.success), results });
  } catch (error) {
    if (admin && user) await admin.from('ai_system_logs').insert({ user_id: user.id, level: 'error', event: 'report.email.failed', message: error.message, success: false });
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});

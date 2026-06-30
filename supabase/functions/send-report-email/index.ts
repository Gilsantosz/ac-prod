import { aggregate, corsHeaders, fetchOperationalData, json, requireAiUser } from '../_shared/aiOperations.ts';
import { renderEmailTemplate } from '../_shared/emailTemplates.ts';

const ERROR_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  ACCESS_DENIED: 403,
  REPORT_REQUIRED: 422,
  RECIPIENT_REQUIRED: 422,
  REPORT_NOT_FOUND: 404,
  RECIPIENTS_NOT_FOUND: 422,
  EMAIL_PROVIDER_NOT_CONFIGURED: 503,
  EMAIL_PROVIDER_FAILED: 502,
};

function csvAttachment(entries: any[]) {
  const columns = ['order_number','lot_code','load_number','customer_trade_name','customer_legal_name','product_name','route_name','finalization_date','pallet_number','cell','process_step','produced','approved_quantity','rejected_quantity','pending_quantity','scrap','downtime','approval_status'];
  const escape = (value: any) => `"${String(value ?? '').replaceAll('"','""')}"`;
  const content = '\uFEFF' + [columns, ...entries.map((row) => columns.map((column) => row[column] ?? ''))].map((row) => row.map(escape).join(';')).join('\n');
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return ERROR_STATUS[message] || 500;
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'REPORT_REQUIRED') return 'Gere e registre o relatório antes do envio.';
  if (message === 'RECIPIENT_REQUIRED') return 'Selecione pelo menos um destinatário.';
  if (message === 'REPORT_NOT_FOUND') return 'Relatório não encontrado.';
  if (message === 'RECIPIENTS_NOT_FOUND') return 'Nenhum destinatário válido.';
  if (message === 'EMAIL_PROVIDER_NOT_CONFIGURED') return 'Provedor de e-mail não configurado. Defina RESEND_API_KEY e REPORT_FROM_EMAIL.';
  if (message === 'EMAIL_PROVIDER_FAILED') return 'O provedor de e-mail recusou o envio.';
  return message;
}

function canSendReport(profile: any, user: any, job: any) {
  if (job.requested_by === user.id) return true;
  if (profile.role === 'admin' || profile.role === 'manager') return true;
  return Boolean(profile.permissions?.manage_automations && profile.permissions?.ai_operations);
}

async function readProviderResult(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function providerErrorMessage(result: any, status: number) {
  const error = result?.error;
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (result?.message) return result.message;
  if (result?.name) return result.name;
  return `Resend HTTP ${status}`;
}

async function recordSystemLog(admin: any, payload: Record<string, unknown>) {
  try {
    await admin.from('ai_system_logs').insert(payload);
  } catch {
    // Logging must not hide the real e-mail response.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let admin: any;
  let user: any;
  try {
    const auth = await requireAiUser(req);
    ({ admin, user } = auth);
    const body = await req.json();
    if (!body.reportJobId) throw new Error('REPORT_REQUIRED');
    
    const recipientIds = body.recipientIds || [];
    const directRecipients = body.directRecipients || [];
    if (!recipientIds.length && !directRecipients.length) throw new Error('RECIPIENT_REQUIRED');
    
    const [{ data: job, error: jobError }, { data: recipients, error: recipientsError }] = await Promise.all([
      admin.from('report_jobs').select('*').eq('id', body.reportJobId).single(),
      recipientIds.length > 0
        ? admin.from('report_recipients').select('*').in('id', recipientIds).eq('active', true)
        : Promise.resolve({ data: [], error: null }),
    ]);
    
    if (jobError || !job) throw new Error('REPORT_NOT_FOUND');
    if (!canSendReport(auth.profile, user, job)) throw new Error('ACCESS_DENIED');
    if (recipientsError) throw recipientsError;
    
    // Construct unified list of recipients
    const allRecipients = [
      ...(recipients || []).map((r: any) => ({ id: r.id, name: r.name, email: r.email })),
      ...directRecipients.map((r: any, idx: number) => ({ id: null, name: r.name || `Destinatário ${idx+1}`, email: r.email })),
    ];
    
    if (allRecipients.length === 0) throw new Error('RECIPIENTS_NOT_FOUND');
    
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('REPORT_FROM_EMAIL');
    if (!apiKey || !from) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
    
    const freshContext = await fetchOperationalData(admin, auth.profile, job.filters || {});
    const summary = aggregate(freshContext.entries, freshContext.occurrences, freshContext.lots);
    const html = renderEmailTemplate(body.templateCode || 'manager-summary', job.title, summary, body.message || 'Segue o relatório industrial solicitado.');
    const subject = String(body.subject || `[AC.Prod] ${job.title}`).slice(0, 180);
    
    const results = [];
    for (const recipient of allRecipients) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [recipient.email],
          subject,
          html,
          attachments: [{ filename: `${job.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.csv`, content: csvAttachment(freshContext.entries) }]
        })
      });
      const providerResult = await readProviderResult(response);
      const success = response.ok;
      const errorMessage = success ? null : providerErrorMessage(providerResult, response.status);
      
      await admin.from('report_email_logs').insert({
        report_job_id: job.id,
        recipient_id: recipient.id,
        recipient_email: recipient.email,
        subject,
        provider: 'resend',
        provider_message_id: providerResult.id || null,
        status: success ? 'sent' : 'failed',
        error_message: errorMessage,
        sent_by: user.id,
        sent_at: success ? new Date().toISOString() : null
      });
      
      results.push({ email: recipient.email, success, error: errorMessage });
    }
    
    const sent = results.filter((item) => item.success).length;
    const failed = results.length - sent;
    await recordSystemLog(admin, {
      user_id: user.id,
      trace_id: job.trace_id,
      level: sent ? 'info' : 'error',
      event: sent ? 'report.email.sent' : 'report.email.failed',
      entity: 'report_job',
      entity_id: job.id,
      metadata: { recipients: results.length, success: sent, failed }
    });
    
    if (!sent) return json({ success: false, error: results[0]?.error || publicError(new Error('EMAIL_PROVIDER_FAILED')), results }, 502);
    return json({ success: true, message: failed ? `${sent} e-mail(s) enviado(s); ${failed} falharam.` : 'Relatório enviado e registrado.', results }, failed ? 207 : 200);
  } catch (error) {
    if (admin && user) await recordSystemLog(admin, { user_id: user.id, level: 'error', event: 'report.email.failed', message: publicError(error), success: false });
    return json({ success: false, error: publicError(error) }, statusFor(error));
  }
});

import { Buffer } from 'node:buffer';
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (message === 'RECIPIENTS_NOT_FOUND') return 'Nenhum destinatário válido encontrado em Usuários/Gestores.';
  if (message === 'EMAIL_PROVIDER_NOT_CONFIGURED') return 'Provedor de e-mail não configurado. Defina SMTP_USER/SMTP_PASS ou RESEND_API_KEY.';
  if (message === 'EMAIL_PROVIDER_FAILED') return 'O provedor de e-mail recusou o envio.';
  return message;
}

function canSendReport(profile: any, user: any, job: any) {
  if (job.requested_by === user.id) return true;
  if (profile.role === 'admin' || profile.role === 'manager') return true;
  return Boolean(profile.permissions?.manage_automations && profile.permissions?.ai_operations);
}

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

function dedupeRecipients(recipients: any[]) {
  const byEmail = new Map<string, any>();
  recipients.forEach((recipient) => {
    const email = String(recipient.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return;
    const current = byEmail.get(email);
    if (!current || recipient.source === 'profile') byEmail.set(email, { ...recipient, email });
  });
  return [...byEmail.values()];
}

async function resolveRecipients(admin: any, body: any) {
  const refs = splitRefs(body);
  const recipients: any[] = [];

  if (refs.profileIds.length) {
    const { data, error } = await admin
      .from('profiles')
      .select('id,name,email,role,active,report_delivery_enabled')
      .in('id', refs.profileIds)
      .eq('active', true);
    if (error) throw error;
    (data || [])
      .filter((profile: any) => ['admin', 'manager', 'supervisor'].includes(profile.role) || profile.report_delivery_enabled === true)
      .forEach((profile: any) => recipients.push({
      source: 'profile',
      profile_id: profile.id,
      recipient_id: null,
      name: profile.name || profile.email,
      email: profile.email,
      role: profile.role,
      }));
  }

  return dedupeRecipients(recipients);
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

function filenameFor(job: any) {
  return `${String(job.title || 'relatorio-acprod').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
}

function resolveEmailProvider() {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const reportFrom = Deno.env.get('REPORT_FROM_EMAIL');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');

  if (smtpUser && smtpPass) {
    return {
      provider: 'smtp',
      smtpUser,
      smtpPass,
      from: reportFrom || `"AC.Prod MES" <${smtpUser}>`,
    };
  }

  if (resendKey) {
    return {
      provider: 'resend',
      resendKey,
      from: reportFrom || 'AC.Prod MES <alertas@acprod.com.br>',
    };
  }

  throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
}

async function sendViaResend(provider: any, opts: any) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: provider.from,
      to: [opts.recipient.email],
      subject: opts.subject,
      html: opts.html,
      attachments: [opts.attachment],
    }),
  });
  const providerResult = await readProviderResult(response);
  const success = response.ok;
  return {
    success,
    providerResult,
    errorMessage: success ? null : providerErrorMessage(providerResult, response.status),
  };
}

async function sendViaSmtp(provider: any, opts: any) {
  try {
    const nodemailer = (await import('npm:nodemailer@6.9.9')).default;
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: provider.smtpUser, pass: provider.smtpPass },
    });

    const info = await transporter.sendMail({
      from: provider.from,
      to: opts.recipient.email,
      subject: opts.subject,
      html: opts.html,
      text: 'Use um cliente de e-mail com suporte a HTML para visualizar este relatório.',
      attachments: [{
        filename: opts.attachment.filename,
        content: Buffer.from(opts.attachment.content, 'base64'),
        contentType: opts.attachment.contentType,
      }],
    });

    return {
      success: true,
      providerResult: { id: info?.messageId || null },
      errorMessage: null,
    };
  } catch (error) {
    return {
      success: false,
      providerResult: {},
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendEmail(provider: any, opts: any) {
  if (provider.provider === 'smtp') return sendViaSmtp(provider, opts);
  return sendViaResend(provider, opts);
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

    const [{ data: job, error: jobError }, recipients] = await Promise.all([
      admin.from('report_jobs').select('*').eq('id', body.reportJobId).single(),
      resolveRecipients(admin, body),
    ]);
    if (jobError || !job) throw new Error('REPORT_NOT_FOUND');
    if (!canSendReport(auth.profile, user, job)) throw new Error('ACCESS_DENIED');
    if (!recipients?.length) throw new Error('RECIPIENTS_NOT_FOUND');

    const emailProvider = resolveEmailProvider();

    const freshContext = await fetchOperationalData(admin, auth.profile, job.filters || {});
    const summary = aggregate(freshContext.entries, freshContext.occurrences, freshContext.lots);
    const html = renderEmailTemplate(body.templateCode || 'manager-summary', job.title, summary, body.message || 'Segue o relatório industrial solicitado.');
    const subject = String(body.subject || `[AC.Prod] ${job.title}`).slice(0, 180);
    const attachment = {
      filename: filenameFor(job),
      content: csvAttachment(freshContext.entries),
      contentType: 'text/csv',
    };
    const results = [];

    // Criar a run no banco
    const runKey = `manual:${job.id}:${new Date().getTime()}`;
    const { data: run, error: runErr } = await admin
      .from('report_schedule_runs')
      .insert({
        report_job_id: job.id,
        trigger_source: body.triggerSource || 'ai',
        scheduled_for: new Date().toISOString(),
        status: 'processing',
        idempotency_key: runKey,
        requested_by: user.id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    const runId = run?.id || null;

    for (const recipient of recipients) {
      const { providerResult, success, errorMessage } = await sendEmail(emailProvider, { recipient, subject, html, attachment });
      
      // Salvar em report_deliveries
      await admin.from('report_deliveries').insert({
        run_id: runId,
        report_job_id: job.id,
        profile_id: recipient.profile_id || null,
        recipient_name_snapshot: recipient.name,
        recipient_email_snapshot: recipient.email,
        recipient_email_normalized: recipient.email.toLowerCase(),
        provider: emailProvider.provider,
        provider_message_id: providerResult.id || null,
        status: success ? 'sent' : 'failed',
        error_message: errorMessage,
        sent_at: success ? new Date().toISOString() : null,
        attempt_count: 1
      });

      // Também salvar em report_email_logs para compatibilidade legada
      await admin.from('report_email_logs').insert({
        report_job_id: job.id,
        recipient_id: recipient.profile_id || recipient.recipient_id || null,
        recipient_email: recipient.email,
        subject,
        provider: emailProvider.provider,
        provider_message_id: providerResult.id || null,
        status: success ? 'sent' : 'failed',
        error_message: errorMessage,
        sent_by: user.id,
        sent_at: success ? new Date().toISOString() : null,
      });

      results.push({ email: recipient.email, name: recipient.name, source: recipient.source, success, error: errorMessage });
    }

    // Atualizar status da Run
    if (runId) {
      const runStatus = results.every(r => r.success) ? 'sent' : results.every(r => !r.success) ? 'failed' : 'partial';
      await admin.from('report_schedule_runs').update({
        status: runStatus,
        finished_at: new Date().toISOString()
      }).eq('id', runId);
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
      metadata: { recipients: results.length, success: sent, failed, sources: [...new Set(results.map((item) => item.source))] },
      success: sent > 0,
    });
    if (!sent) return json({ success: false, error: results[0]?.error || publicError(new Error('EMAIL_PROVIDER_FAILED')), results }, 502);
    return json({ success: true, message: failed ? `${sent} e-mail(s) enviado(s); ${failed} falharam.` : 'Relatório enviado e registrado.', results }, failed ? 207 : 200);
  } catch (error) {
    if (admin && user) await recordSystemLog(admin, { user_id: user.id, level: 'error', event: 'report.email.failed', message: publicError(error), success: false });
    return json({ success: false, error: publicError(error) }, statusFor(error));
  }
});

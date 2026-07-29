import { Buffer } from "node:buffer";

function leoFlowSender(value: string) {
  const configured = String(value || '').trim();
  const bracketed = configured.match(/<([^>]+)>/)?.[1];
  const address = bracketed || configured.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return address ? `"Leo Flow" <${address}>` : configured;
}

export async function sendEmail(opts: {
  recipients: string[];
  subject: string;
  html: string;
  attachments?: any[];
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  const reportFrom = leoFlowSender(Deno.env.get('REPORT_FROM_EMAIL') || 'Leo Flow <alertas@acprod.com.br>');

  // O Gmail/SMTP é o canal oficial do sistema. Resend permanece como
  // contingência para que uma indisponibilidade temporária não perca o envio.
  if (smtpUser && smtpPass) {
    const smtpResult = await sendViaSmtp(smtpUser, smtpPass, opts);
    if (smtpResult.success || !resendKey) return smtpResult;
    console.warn('SMTP Gmail indisponível; tentando contingência Resend.');
  }

  if (resendKey) return sendViaResend(resendKey, reportFrom, opts);
  return { success: false, error: 'Nenhum provedor de e-mail configurado (SMTP_USER/SMTP_PASS ou RESEND_API_KEY ausentes).' };
}

async function sendViaResend(resendKey: string, reportFrom: string, opts: any) {
  console.log(`Usando contingência Resend para envio para ${opts.recipients.join(', ')}`);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: reportFrom,
        to: opts.recipients,
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments || []
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return {
      success: true,
      provider: 'resend',
      providerMessageId: data?.id || null,
      providerResponse: `HTTP ${res.status}`,
      accepted: opts.recipients,
      rejected: [],
    };
  } catch (err: any) {
    console.error('Erro no envio via Resend:', err);
    return { success: false, error: err.message };
  }
}

async function sendViaSmtp(user: string, pass: string, opts: any) {
  console.log(`Usando SMTP Gmail para envio para ${opts.recipients.join(', ')}`);
  try {
    const nodemailer = (await import("npm:nodemailer@6.9.9")).default;
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass }
    });

    const mailOptions: any = {
      from: `"Leo Flow" <${user}>`,
      to: opts.recipients,
      subject: opts.subject,
      html: opts.html,
      text: "Use um cliente de e-mail com suporte a HTML para visualizar este relatório."
    };

    if (opts.attachments && opts.attachments.length > 0) {
      mailOptions.attachments = opts.attachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType
      }));
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      provider: 'smtp',
      providerMessageId: info.messageId || null,
      providerResponse: info.response || null,
      accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : opts.recipients,
      rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    };
  } catch (err: any) {
    console.error('Erro no envio via SMTP:', err);
    return { success: false, error: err.message };
  }
}

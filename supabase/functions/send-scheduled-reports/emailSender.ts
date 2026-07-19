import { Buffer } from "node:buffer";

export async function sendEmail(opts: {
  recipients: string[];
  subject: string;
  html: string;
  attachments?: any[];
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  const reportFrom = Deno.env.get('REPORT_FROM_EMAIL') || 'AC.Prod MES <alertas@acprod.com.br>';

  if (resendKey) {
    console.log(`Usando Resend API para envio para ${opts.recipients.join(', ')}`);
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
      return { success: true };
    } catch (err: any) {
      console.error('Erro no envio via Resend:', err);
      if (smtpUser && smtpPass) {
        return sendViaSmtp(smtpUser, smtpPass, opts);
      }
      return { success: false, error: err.message };
    }
  } else if (smtpUser && smtpPass) {
    return sendViaSmtp(smtpUser, smtpPass, opts);
  } else {
    return { success: false, error: 'Nenhum provedor de e-mail configurado (RESEND_API_KEY ou SMTP_USER/SMTP_PASS ausentes).' };
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
      from: `"AC.Prod MES" <${user}>`,
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

    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err: any) {
    console.error('Erro no envio via SMTP:', err);
    return { success: false, error: err.message };
  }
}

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

const PUBLIC_APP_URL = 'https://gilsantosz.github.io/ac-prod';
const MIN_REQUEST_INTERVAL_MS = 60_000;
const MAX_REQUESTS_PER_EMAIL_HOUR = 5;
const MAX_REQUESTS_PER_IP_HOUR = 20;

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const recoveryEmailHtml = (resetLink: string) => (
  `<div style="font-family: sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
    <h2 style="color: #005f2f; margin-bottom: 8px;">Leo Sob Medidas</h2>
    <p style="color: #475569; font-size: 14px;">Você solicitou a redefinição de senha para o sistema Leo Flow.</p>
    <div style="margin: 24px 0;">
      <a href="${resetLink}" style="background-color: #005f2f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Redefinir Minha Senha</a>
    </div>
    <p style="color: #94a3b8; font-size: 12px;">Se você não solicitou esta alteração, ignore este e-mail.</p>
  </div>`
);

const sendViaGmailSmtp = async (
  recipient: string,
  resetLink: string,
) => {
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  if (!smtpUser || !smtpPass) return false;

  const nodemailer = (await import('npm:nodemailer@6.9.9')).default;
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: Deno.env.get('AUTH_EMAIL_FROM')
      || Deno.env.get('REPORT_FROM_EMAIL')
      || `"Leo Flow" <${smtpUser}>`,
    to: recipient,
    subject: 'Leo Flow — Recuperação de Senha',
    html: recoveryEmailHtml(resetLink),
    text: `Use este link para redefinir sua senha no Leo Flow: ${resetLink}`,
  });
  return true;
};

const sendViaConfiguredResend = async (
  recipient: string,
  resetLink: string,
) => {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const configuredFrom = Deno.env.get('AUTH_EMAIL_FROM')
    || Deno.env.get('REPORT_FROM_EMAIL');
  if (!resendKey || !configuredFrom) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: configuredFrom,
      to: [recipient],
      subject: 'Leo Flow — Recuperação de Senha',
      html: recoveryEmailHtml(resetLink),
      text: `Use este link para redefinir sua senha no Leo Flow: ${resetLink}`,
    }),
  });

  if (!response.ok) {
    const providerError = await response.text();
    throw new Error(`Resend recusou a mensagem: ${providerError}`);
  }
  return true;
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'Serviço administrativo indisponível.' }, 503);
  }

  try {
    const body = await request.json();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: 'Informe um e-mail válido.' }, 422);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const remoteAddress = (
      request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]
      || 'unknown'
    ).trim();
    const [emailHash, ipHash] = await Promise.all([
      sha256(`${serviceRoleKey}:email:${email}`),
      sha256(`${serviceRoleKey}:ip:${remoteAddress}`),
    ]);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [
      { data: recentEmailRequests, error: emailLimitError },
      { count: recentIpCount, error: ipLimitError },
    ] = await Promise.all([
      admin
        .from('password_recovery_requests')
        .select('created_at')
        .eq('email_hash', emailHash)
        .gte('created_at', hourAgo)
        .order('created_at', { ascending: false })
        .limit(MAX_REQUESTS_PER_EMAIL_HOUR),
      admin
        .from('password_recovery_requests')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', hourAgo),
    ]);

    if (emailLimitError || ipLimitError) {
      throw emailLimitError || ipLimitError;
    }

    const newestRequestAt = recentEmailRequests?.[0]?.created_at
      ? new Date(recentEmailRequests[0].created_at).getTime()
      : 0;
    const retryAfterSeconds = newestRequestAt
      ? Math.max(0, Math.ceil((MIN_REQUEST_INTERVAL_MS - (Date.now() - newestRequestAt)) / 1000))
      : 0;

    if (retryAfterSeconds > 0) {
      return json({
        success: false,
        error: `Aguarde ${retryAfterSeconds} segundos antes de solicitar outro link.`,
        retry_after_seconds: retryAfterSeconds,
      }, 429);
    }

    if (
      (recentEmailRequests?.length || 0) >= MAX_REQUESTS_PER_EMAIL_HOUR
      || (recentIpCount || 0) >= MAX_REQUESTS_PER_IP_HOUR
    ) {
      return json({
        success: false,
        error: 'Limite temporário de recuperação atingido. Aguarde uma hora e tente novamente.',
      }, 429);
    }

    const { error: requestLogError } = await admin
      .from('password_recovery_requests')
      .insert({ email_hash: emailHash, ip_hash: ipHash });
    if (requestLogError) throw requestLogError;

    // 1. Verifica se o perfil existe no sistema
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, active')
      .ilike('email', email)
      .maybeSingle();

    if (!profile) {
      // Para evitar enumeração de e-mails, responde sucesso amigável
      return json({ success: true, message: 'Se o e-mail estiver cadastrado, as instruções foram processadas.' }, 200);
    }

    if (profile.active === false) {
      return json({ success: true, message: 'Se o e-mail estiver cadastrado, as instruções foram processadas.' }, 200);
    }

    // A URL é definida somente no servidor para nunca gerar links localhost.
    const redirectTo = `${PUBLIC_APP_URL}/reset-password`;
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
      options: { redirectTo },
    });
    if (linkError) throw linkError;

    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) throw new Error('O Supabase não gerou o token de recuperação.');
    // O e-mail aponta primeiro para o app. Assim, scanners corporativos que
    // fazem GET automático não consomem o token no endpoint /verify.
    const resetLink = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
    let sent = false;

    try {
      sent = await sendViaGmailSmtp(profile.email, resetLink);
    } catch (smtpError) {
      console.error('[recover-password] Gmail SMTP recusou a mensagem:', smtpError);
    }

    if (!sent) {
      try {
        sent = await sendViaConfiguredResend(profile.email, resetLink);
      } catch (resendError) {
        console.error('[recover-password] Resend recusou a mensagem:', resendError);
      }
    }

    if (!sent) {
      const { error: resetError } = await admin.auth.resetPasswordForEmail(
        profile.email,
        { redirectTo },
      );
      if (resetError) {
        console.error('[recover-password] SMTP nativo recusou a mensagem:', resetError);
        throw new Error(
          'Não foi possível enviar o e-mail. Verifique a configuração SMTP do sistema.',
        );
      }
    }

    return json({
      success: true,
      message: 'Instruções de recuperação enviadas com sucesso.',
    }, 200);

  } catch (error) {
    console.error('[recover-password] Erro:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao processar recuperação de senha.',
    }, 500);
  }
});

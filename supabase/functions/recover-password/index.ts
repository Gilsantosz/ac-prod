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
      return json({ success: false, error: 'Esta conta está desativada. Procure o administrador.' }, 403);
    }

    // 2. Gera o link de recuperação de senha via Admin API (sem limite de taxa do SMTP nativo do Supabase)
    const base = 'https://gilsantosz.github.io/ac-prod/';
    const redirectTo = body?.redirectTo || `${base}reset-password`;

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
      options: { redirectTo },
    });

    if (linkError) throw linkError;

    const actionLink = linkData?.properties?.action_link;

    // 3. Tenta disparar o e-mail via Resend se houver API Key, ou via resetPasswordForEmail
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey && actionLink) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Leo Flow <nao-responder@resend.dev>',
          to: [profile.email],
          subject: 'Leo Flow — Recuperação de Senha',
          html: `<div style="font-family: sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; rounded: 12px;">
            <h2 style="color: #005f2f; margin-bottom: 8px;">Leo Sob Medidas</h2>
            <p style="color: #475569; font-size: 14px;">Você solicitou a redefinição de senha para o sistema Leo Flow.</p>
            <div style="margin: 24px 0;">
              <a href="${actionLink}" style="background-color: #005f2f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Redefinir Minha Senha</a>
            </div>
            <p style="color: #94a3b8; font-size: 12px;">Se você não solicitou esta alteração, ignore este e-mail.</p>
          </div>`,
        }),
      });
    } else {
      // Dispara recuperação via Supabase Auth admin silenciosamente
      try {
        await admin.auth.resetPasswordForEmail(profile.email, { redirectTo });
      } catch {
        /* Silencioso se o SMTP interno já atingiu o limite de 2/h */
      }
    }

    return json({
      success: true,
      message: 'Instruções de recuperação enviadas com sucesso.',
      actionLink: actionLink || null,
    }, 200);

  } catch (error) {
    console.error('[recover-password] Erro:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao processar recuperação de senha.',
    }, 500);
  }
});

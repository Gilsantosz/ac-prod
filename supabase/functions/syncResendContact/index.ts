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

// Mantida somente por compatibilidade com versões antigas do frontend.
// Os destinatários são resolvidos no momento de cada envio; não é necessário
// exportar a agenda de usuários do AC.Prod para o provedor de e-mail.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!supabaseUrl || !serviceRoleKey || !token) return json({ success: false, error: 'Autenticação necessária.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authResult, error: authError } = await admin.auth.getUser(token);
  if (authError || !authResult.user) return json({ success: false, error: 'Sessão inválida ou expirada.' }, 401);

  const { data: caller } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', authResult.user.id)
    .maybeSingle();
  if (!caller || caller.active === false || caller.role !== 'admin') {
    return json({ success: false, error: 'Apenas administradores podem gerenciar destinatários.' }, 403);
  }

  return json({
    success: true,
    synchronized: false,
    message: 'Destinatário mantido apenas no AC.Prod e resolvido com segurança no momento do envio.',
  });
});

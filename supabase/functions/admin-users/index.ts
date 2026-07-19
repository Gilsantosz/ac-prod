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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(['operator', 'supervisor', 'manager', 'admin', 'viewer']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'Serviço administrativo indisponível.' }, 503);
  }

  try {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, error: 'Autenticação necessária.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userResult, error: userError } = await admin.auth.getUser(token);
    if (userError || !userResult.user) {
      return json({ success: false, error: 'Sessão inválida ou expirada.' }, 401);
    }

    const { data: caller } = await admin
      .from('profiles')
      .select('id, role, active')
      .eq('id', userResult.user.id)
      .maybeSingle();

    if (!caller || caller.active === false || caller.role !== 'admin') {
      return json({ success: false, error: 'Apenas administradores podem cadastrar contas.' }, 403);
    }

    const body = await request.json();
    if (body?.action !== 'create') {
      return json({ success: false, error: 'Ação administrativa inválida.' }, 422);
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const role = String(body.role || 'operator').trim().toLowerCase();
    const cell = String(body.cell || '').trim();
    const permissions = body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions)
      ? body.permissions
      : {};

    if (!EMAIL_PATTERN.test(email)) return json({ success: false, error: 'Informe um e-mail válido.' }, 422);
    if (password.length < 8) return json({ success: false, error: 'A senha deve ter pelo menos 8 caracteres.' }, 422);
    if (!name) return json({ success: false, error: 'Informe o nome do colaborador.' }, 422);
    if (!ALLOWED_ROLES.has(role)) return json({ success: false, error: 'Papel de acesso inválido.' }, 422);

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (existingProfile) {
      return json({ success: false, error: 'Este e-mail já está cadastrado no sistema.' }, 409);
    }

    let authUser = null;
    const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;
    authUser = existingUsers.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;

    if (authUser) {
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (updateError) throw updateError;
      authUser = updated.user;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (createError) throw createError;
      authUser = created.user;
    }

    if (!authUser?.id) throw new Error('A conta de autenticação não foi criada.');

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUser.id,
        email,
        name,
        role,
        cell,
        permissions,
        active: true,
      }, { onConflict: 'id' })
      .select('id, email, name, role, cell, permissions, active, report_delivery_enabled')
      .single();
    if (profileError) throw profileError;

    await admin.from('system_audit_logs').insert({
      user_id: caller.id,
      user_role: caller.role,
      action: 'create',
      entity: 'profile',
      entity_id: profile.id,
      entity_label: profile.email,
      page: 'Usuários',
      route: '/usuarios',
      method: 'EDGE_FUNCTION',
      new_value: { email: profile.email, name: profile.name, role: profile.role, cell: profile.cell },
      success: true,
    });

    return json({ success: true, user: profile }, 201);
  } catch (error) {
    console.error('[admin-users] Falha administrativa:', error instanceof Error ? error.message : error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao cadastrar usuário.',
    }, 500);
  }
});


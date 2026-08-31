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
const ROLE_RANK: Record<string, number> = {
  viewer: 10,
  operator: 10,
  supervisor: 20,
  manager: 30,
  admin: 40,
};

type CallerProfile = {
  id: string;
  role: string;
  active: boolean | null;
  permissions: Record<string, unknown> | null;
  managed_cells: string[] | null;
  cell: string | null;
};

function authorityRank(caller: CallerProfile): number {
  const roleRank = ROLE_RANK[caller.role] || 0;
  if (caller.permissions?.manage_users === true) return Math.max(roleRank, 20);
  if (caller.permissions?.manage_operators === true) return Math.max(roleRank, 15);
  return roleRank;
}

function canManageTarget(caller: CallerProfile, targetRole: string): boolean {
  if (caller.role === 'admin') return true;
  return (ROLE_RANK[targetRole] || 0) < authorityRank(caller);
}

function requestedPermissionEscalations(
  caller: CallerProfile,
  requested: Record<string, unknown>,
): string[] {
  if (caller.role === 'admin') return [];
  return Object.entries(requested)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
    .filter((key) => caller.permissions?.[key] !== true);
}

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
      .select('id, role, active, permissions, managed_cells, cell')
      .eq('id', userResult.user.id)
      .maybeSingle() as { data: CallerProfile | null };

    const isAuthorized =
      caller &&
      caller.active !== false &&
      (
        caller.role === 'admin' ||
        caller.role === 'manager' ||
        caller.role === 'supervisor' ||
        caller.permissions?.manage_users === true ||
        caller.permissions?.manage_operators === true
      );

    if (!isAuthorized) {
      return json({ success: false, error: 'Permissão insuficiente para alterar senhas ou gerenciar colaboradores.' }, 403);
    }

    const body = await request.json();

    if (body?.action === 'reset_password' || body?.action === 'update_password') {
      const userId = String(body.userId || body.id || '').trim();
      const newPassword = String(body.password || body.newPassword || '');
      if (!userId) return json({ success: false, error: 'ID do usuário não fornecido.' }, 422);
      if (newPassword.length < 8) return json({ success: false, error: 'A senha deve ter pelo menos 8 caracteres.' }, 422);

      const { data: targetProfile } = await admin
        .from('profiles')
        .select('id, email, name, role')
        .eq('id', userId)
        .maybeSingle();

      if (!targetProfile) {
        if (caller.role !== 'admin') {
          return json({ success: false, error: 'Somente administradores podem alterar contas sem perfil válido.' }, 403);
        }
      } else if (!canManageTarget(caller, String(targetProfile.role || 'operator'))) {
        return json({ success: false, error: 'Você não pode redefinir a senha de uma conta com nível igual ou superior ao seu.' }, 403);
      }

      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: newPassword,
      });
      if (updateError) throw updateError;

      await admin.from('system_audit_logs').insert({
        user_id: caller.id,
        user_role: caller.role,
        action: 'reset_password',
        entity: 'profile',
        entity_id: userId,
        entity_label: targetProfile?.email || userId,
        page: 'Usuários',
        route: '/usuarios',
        method: 'EDGE_FUNCTION',
        new_value: { password_reset: true },
        success: true,
      });

      return json({ success: true, user: updated.user }, 200);
    }

    if (body?.action !== 'create') {
      return json({ success: false, error: 'Ação administrativa inválida.' }, 422);
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const role = String(body.role || 'operator').trim().toLowerCase();
    const cell = String(body.cell || '').trim();
    const managedCells = Array.from(new Set(
      (Array.isArray(body.managed_cells) ? body.managed_cells : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean),
    ));
    const accessScope = body.access_scope && typeof body.access_scope === 'object' && !Array.isArray(body.access_scope)
      ? body.access_scope
      : {};
    const permissions = body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions)
      ? body.permissions
      : {};

    if (!EMAIL_PATTERN.test(email)) return json({ success: false, error: 'Informe um e-mail válido.' }, 422);
    if (password.length < 8) return json({ success: false, error: 'A senha deve ter pelo menos 8 caracteres.' }, 422);
    if (!name) return json({ success: false, error: 'Informe o nome do colaborador.' }, 422);
    if (!ALLOWED_ROLES.has(role)) return json({ success: false, error: 'Papel de acesso inválido.' }, 422);
    if (!canManageTarget(caller, role)) {
      return json({ success: false, error: 'Você não pode criar uma conta com nível igual ou superior ao seu.' }, 403);
    }
    if (role === 'operator' && managedCells.length === 0) {
      return json({ success: false, error: 'Selecione pelo menos uma célula autorizada para o operador.' }, 422);
    }

    const permissionEscalations = requestedPermissionEscalations(caller, permissions);
    if (permissionEscalations.length > 0) {
      return json({
        success: false,
        error: 'Não é permitido conceder permissões que o próprio responsável não possui.',
        invalid_permissions: permissionEscalations,
      }, 403);
    }

    let canonicalManagedCells: string[] = [];
    if (managedCells.length > 0) {
      const { data: allCells, error: cellsError } = await admin
        .from('cells')
        .select('id, name, active');
      if (cellsError) throw cellsError;

      const activeCells = (allCells || []).filter((c) => c.active !== false);
      const activeCellLookup = new Map<string, string>();
      for (const c of activeCells) {
        if (c.id) activeCellLookup.set(String(c.id).toLowerCase().trim(), String(c.name || '').trim());
        if (c.name) {
          const rawName = String(c.name).trim();
          activeCellLookup.set(rawName.toLowerCase(), rawName);
          activeCellLookup.set(rawName.toLowerCase().replace(/\s+/g, ' '), rawName);
        }
      }

      const invalidCells: string[] = [];
      const resolvedCells: string[] = [];

      for (const rawCell of managedCells) {
        const normKey = String(rawCell || '').toLowerCase().trim().replace(/\s+/g, ' ');
        if (activeCellLookup.has(normKey)) {
          resolvedCells.push(activeCellLookup.get(normKey)!);
        } else {
          invalidCells.push(rawCell);
        }
      }

      if (invalidCells.length > 0) {
        return json({
          success: false,
          error: `Uma ou mais células selecionadas (${invalidCells.join(', ')}) não existem ou estão inativas.`,
        }, 422);
      }

      canonicalManagedCells = Array.from(new Set(resolvedCells));
    }

    const callerCells = Array.from(new Set(
      (Array.isArray(caller.managed_cells) && caller.managed_cells.length > 0
        ? caller.managed_cells
        : caller.cell ? [caller.cell] : [])
        .map((value) => String(value || '').toLowerCase().trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ));
    if (caller.role !== 'admin' && callerCells.length > 0) {
      const outsideCallerScope = canonicalManagedCells.filter((cellName) => {
        const norm = String(cellName).toLowerCase().trim().replace(/\s+/g, ' ');
        return !callerCells.includes(norm);
      });
      if (outsideCallerScope.length > 0) {
        return json({ success: false, error: 'Uma ou mais células estão fora do seu escopo de gestão.' }, 403);
      }
    }

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (existingProfile) {
      return json({ success: false, error: 'Este e-mail já está cadastrado no sistema.' }, 409);
    }

    let authUser = null;

    // Tenta criar diretamente — se já existir, o Supabase retorna erro com user_id
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) {
      // Se o erro indica que o e-mail já existe no Auth, recupera e atualiza
      const isDuplicate =
        createError.message?.toLowerCase().includes('already been registered') ||
        createError.message?.toLowerCase().includes('already exists') ||
        createError.message?.toLowerCase().includes('duplicate') ||
        (createError as any)?.status === 422;

      if (isDuplicate) {
        // Busca o usuário existente pelo e-mail via admin API
        const { data: listResult, error: listErr } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 50,
        });
        const existingAuth = listErr
          ? null
          : listResult?.users?.find((u) => u.email?.toLowerCase() === email);

        if (!existingAuth) {
          // Fallback: tenta criar de novo ou retorna erro amigável
          return json({
            success: false,
            error: 'Este e-mail já possui uma conta de autenticação mas não foi possível recuperá-la. Tente resetar a senha.',
          }, 409);
        }

        const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existingAuth.id, {
          password,
          email_confirm: true,
          user_metadata: { name },
        });
        if (updateError) throw updateError;
        authUser = updated.user;
      } else {
        throw createError;
      }
    } else {
      authUser = created.user;
    }

    if (!authUser?.id) throw new Error('A conta de autenticação não foi criada.');

    const reportDeliveryEnabled = Boolean(body.report_delivery_enabled ?? body.report_settings?.report_delivery_enabled);
    const receivesDailyReport = Boolean(body.receives_daily_report ?? body.report_settings?.receives_daily_report);

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUser.id,
        email,
        name,
        role,
        cell: canonicalManagedCells[0] || cell,
        managed_cells: canonicalManagedCells,
        access_scope: caller.role === 'admin'
          ? { ...accessScope, cells: canonicalManagedCells }
          : { cells: canonicalManagedCells, machines: [] },
        permissions,
        active: true,
        report_delivery_enabled: reportDeliveryEnabled,
        receives_daily_report: receivesDailyReport,
      }, { onConflict: 'id' })
      .select('id, email, name, role, cell, managed_cells, access_scope, permissions, active, report_delivery_enabled, receives_daily_report')
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
      new_value: {
        email: profile.email,
        name: profile.name,
        role: profile.role,
        cell: profile.cell,
        managed_cells: profile.managed_cells,
      },
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

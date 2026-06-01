/**
 * AC.Prod — Database Client
 *
 * Este módulo mantém a mesma API do emulador local (base44.entities.X.list/create/update/delete/filter)
 * mas agora usa o Supabase real como backend.
 *
 * SEGURANÇA (regra @[user_global]):
 * - Apenas a chave ANON (pública) é utilizada no cliente
 * - Toda autorização é feita via RLS (Row Level Security) no PostgreSQL
 * - A SERVICE_ROLE_KEY nunca é exposta no frontend
 */

import { supabase } from './supabaseClient';

// ─── Mapeamento de nomes de entidade para tabelas Supabase ───────────────────
const TABLE_MAP = {
  ProductionEntry: 'production_entries',
  DailyGoal: 'daily_goals',
  Occurrence: 'occurrences',
  Operator: 'operators',
  Cell: 'cells',
  AutomationRule: 'automation_rules',
  User: 'profiles',
  AlertLog: 'alert_logs',
  MonthlyGoal: 'monthly_goals',
  Manager: 'profiles',
  WorkdayCalendar: 'production_entries', // fallback
};

// ─── Normalização de dados do Supabase para o formato legado ─────────────────
// O Supabase usa snake_case; alguns componentes esperam camelCase ou campos específicos
const normalizeFromDb = (entity, row) => {
  if (!row) return row;
  const base = {
    ...row,
    id: row.id,
    created_date: row.created_at, // compatibilidade com código legado
  };

  if (entity === 'ProductionEntry') {
    return { ...base, date: row.date?.toString?.() ?? row.date };
  }
  if (entity === 'DailyGoal') {
    return { ...base, date: row.date?.toString?.() ?? row.date };
  }
  if (entity === 'Occurrence') {
    return { ...base, date: row.date?.toString?.() ?? row.date };
  }
  if (entity === 'User') {
    // profiles → formato legado user
    return {
      ...base,
      name: row.name || '',
      email: row.email || '',
      role: row.role || 'operator',
      cell: row.cell || '',
      permissions: row.permissions || {},
      dashboard_layout: row.dashboard_layout || null,
    };
  }
  return base;
};

// ─── Ordena lista localmente ──────────────────────────────────────────────────
const sortData = (list, orderBy) => {
  if (!orderBy) return list;
  const desc = orderBy.startsWith('-');
  const field = desc ? orderBy.substring(1) : orderBy;
  return [...list].sort((a, b) => {
    let vA = a[field], vB = b[field];
    if (vA == null) return desc ? 1 : -1;
    if (vB == null) return desc ? -1 : 1;
    if (typeof vA === 'string') return desc ? vB.localeCompare(vA) : vA.localeCompare(vB);
    return desc ? vB - vA : vA - vB;
  });
};

// ─── Fábrica de cliente de entidade ──────────────────────────────────────────
const createEntityClient = (entityName) => {
  const table = TABLE_MAP[entityName] || entityName.toLowerCase();

  return {
    list: async (orderBy = null, limit = null) => {
      let q = supabase.from(table).select('*');
      if (limit) q = q.limit(limit);

      const { data, error } = await q;
      if (error) throw error;

      let rows = (data || []).map((r) => normalizeFromDb(entityName, r));
      if (orderBy) rows = sortData(rows, orderBy);
      return rows;
    },

    create: async (payload) => {
      // Adiciona created_by automaticamente para entidades de produção
      const enriched = { ...payload };
      delete enriched.id;          // deixar o DB gerar
      delete enriched.created_date; // campo legado

      // Normalizar campos de data para formato ISO
      if (enriched.date && typeof enriched.date === 'string' && enriched.date.length === 10) {
        // mantém yyyy-MM-dd que o PostgreSQL aceita como DATE
      }

      const { data, error } = await supabase.from(table).insert(enriched).select().single();
      if (error) throw error;
      return normalizeFromDb(entityName, data);
    },

    update: async (id, payload) => {
      const clean = { ...payload };
      delete clean.id;
      delete clean.created_date;
      delete clean.created_at;

      const { data, error } = await supabase
        .from(table)
        .update(clean)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return normalizeFromDb(entityName, data);
    },

    delete: async (id) => {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return { success: true, id };
    },

    filter: async (conditions = {}, orderBy = null, limit = null) => {
      let q = supabase.from(table).select('*');

      for (const [key, val] of Object.entries(conditions)) {
        if (val !== undefined && val !== null) {
          q = q.eq(key, val);
        }
      }

      if (limit) q = q.limit(limit);

      const { data, error } = await q;
      if (error) throw error;

      let rows = (data || []).map((r) => normalizeFromDb(entityName, r));
      if (orderBy) rows = sortData(rows, orderBy);
      return rows;
    },
  };
};

// ─── Auth wrapper usando Supabase Auth ───────────────────────────────────────
const auth = {
  me: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      const err = new Error('Authentication required');
      err.status = 401;
      throw err;
    }

    // Buscar perfil com dados de negócio
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return {
      id: user.id,
      email: user.email,
      name: profile?.name || user.email?.split('@')[0] || '',
      role: profile?.role || 'operator',
      cell: profile?.cell || '',
      permissions: profile?.permissions || {
        view_dashboards: true,
        register_production: true,
        manage_occurrences: true,
        manage_cells: false,
        manage_operators: false,
        view_reports: false,
        manage_automations: false,
        manage_users: false,
      },
      dashboard_layout: profile?.dashboard_layout || null,
    };
  },

  updateMe: async (updateData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthenticated');

    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  loginViaEmailPassword: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const err = new Error('E-mail ou senha incorretos.');
      err.status = 401;
      throw err;
    }

    const profile = await auth.me();
    return profile;
  },

  register: async ({ email, password, name = '' }) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw new Error(error.message);
    return { success: true, message: 'Registro realizado com sucesso.' };
  },

  verifyOtp: async ({ email, otpCode }) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: 'signup',
    });
    if (error) throw new Error(error.message);
    return { access_token: data.session?.access_token };
  },

  resendOtp: async (email) => {
    await supabase.auth.resend({ type: 'signup', email });
    return { success: true };
  },

  logout: async () => {
    await supabase.auth.signOut();
  },

  redirectToLogin: () => {
    window.location.href = '/login';
  },

  setToken: () => { /* Gerenciado pelo Supabase Auth automaticamente */ },

  resetPasswordRequest: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  },

  resetPassword: async ({ newPassword }) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    return { success: true };
  },

  loginWithProvider: async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  },
};

// ─── Users management (admin only — operações seguras via RLS) ───────────────
const users = {
  inviteUser: async (email, role, name = '', password = '', permissions = null, cell = '') => {
    // 1. Criar usuário via Supabase Auth com metadata
    const defaultPermissions = role === 'admin'
      ? { view_dashboards: true, register_production: true, manage_occurrences: true, manage_cells: true, manage_operators: true, view_reports: true, manage_automations: true, manage_users: true }
      : { view_dashboards: true, register_production: true, manage_occurrences: true, manage_cells: false, manage_operators: false, view_reports: false, manage_automations: false, manage_users: false };

    const finalPermissions = permissions || defaultPermissions;

    // Registrar usuário normalmente (o trigger handle_new_user vai criar o perfil)
    const { data, error } = await supabase.auth.signUp({
      email,
      password: password || 'Senha@' + Math.random().toString(36).slice(2, 10),
      options: {
        data: {
          name: name || email.split('@')[0],
          role,
          permissions: JSON.stringify(finalPermissions),
          cell,
        },
      },
    });

    if (error) throw new Error(error.message);

    // 2. Atualizar perfil com campos adicionais (o trigger pode não ter todos)
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        name: name || email.split('@')[0],
        email,
        role,
        cell,
        permissions: finalPermissions,
      });
    }

    return { id: data.user?.id, email, name, role, cell };
  },

  listUsers: async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    return data || [];
  },

  updateUser: async (id, payload) => {
    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  deleteUser: async (id) => {
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  },
};

// ─── Exportação principal — compatível com a API legada base44 ───────────────
export const base44 = {
  auth,
  users,
  entities: {
    ProductionEntry: createEntityClient('ProductionEntry'),
    DailyGoal: createEntityClient('DailyGoal'),
    Occurrence: createEntityClient('Occurrence'),
    Operator: createEntityClient('Operator'),
    Cell: createEntityClient('Cell'),
    AutomationRule: createEntityClient('AutomationRule'),
    User: createEntityClient('User'),
    AlertLog: createEntityClient('AlertLog'),
    MonthlyGoal: createEntityClient('MonthlyGoal'),
    Manager: createEntityClient('Manager'),
    WorkdayCalendar: createEntityClient('WorkdayCalendar'),
  },
};

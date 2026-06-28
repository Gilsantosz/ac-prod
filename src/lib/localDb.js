/**
 * Leo Flow — Database Client
 *
 * Este módulo mantém a mesma API do emulador local (base44.entities.X.list/create/update/delete/filter)
 * mas agora usa o Supabase real como backend.
 *
 * SEGURANÇA (regra @[user_global]):
 * - Apenas a chave ANON (pública) é utilizada no cliente
 * - Toda autorização é feita via RLS (Row Level Security) no PostgreSQL
 * - A SERVICE_ROLE_KEY nunca é exposta no frontend
 */

import { clearPersistedAuthSession, persistAuthSession, supabase } from './supabaseClient';

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
  WorkdayCalendar: 'workday_calendar', // tabela real (migration 007)
  NotificationConfig: 'notification_configs',
  // ─── Rastreabilidade MES Leo Madeiras ───────────────────────────────
  ProductionOrder: 'production_orders',
  ProductionLot: 'production_lots',
  ProductionOrderItem: 'production_order_items',
  ProductionLotItem: 'production_lot_items',
  ProductionRoute: 'production_routes',
  ProductionTag: 'production_tags',
  ProductionStageReading: 'production_stage_readings',
  ProductionSearchIndex: 'production_search_index',
  ReaderDevice: 'reader_devices',
  TraceabilityLog: 'traceability_logs',
  LotItem: 'lot_items',
  PieceInstance: 'piece_instances',
  RoutingStep: 'routing_steps',
  RouteTemplate: 'route_templates',
  RouteTemplateStep: 'route_template_steps',
  LotStepEvent: 'lot_step_events',
  Package: 'packages',
  PackageItem: 'package_items',
  Shipment: 'shipments',
  PromobIntegration: 'promob_integrations',
  PromobImportBatch: 'promob_import_batches',
  PromobImportDifference: 'promob_import_differences',
  OfflineEventQueue: 'offline_event_queue',
  SystemAuditLog: 'system_audit_logs',
  ReportSchedule: 'report_schedules',
  ReportDeliveryLog: 'report_delivery_logs',
  BackupPolicy: 'backup_policies',
  BackupFile: 'backup_files',
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
  if (entity === 'Cell') {
    const sh = row.shift_hours || {};
    return {
      ...base,
      hoursShift1: Number(sh.shift1 ?? 8),
      hoursShift2: Number(sh.shift2 ?? 8),
      hoursShift3: Number(sh.shift3 ?? 8),
    };
  }
  if (entity === 'Operator') {
    // Migration 018: colunas reais (registration, primary_cell, cells, shift, login_enabled)
    // Fallback legacy: se role ainda for JSON (registros não migrados), extrair de lá
    let legacyRole = 'operator';
    let legacyReg = '';
    let legacyShift = '';
    let legacyCells = [];
    if (row.role && row.role.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(row.role);
        legacyRole  = parsed.role || 'operator';
        legacyReg   = parsed.registration || '';
        legacyShift = parsed.shift || '';
        legacyCells = Array.isArray(parsed.cells) ? parsed.cells : [];
      } catch (_) { /* manter defaults */ }
    } else {
      legacyRole = row.role || 'operator';
    }
    return {
      ...base,
      registration:  row.registration  || legacyReg,
      primary_cell:  row.primary_cell  || null,
      shift:         row.shift         || legacyShift,
      cells:         Array.isArray(row.cells) && row.cells.length > 0 ? row.cells : legacyCells,
      login_enabled: row.login_enabled !== false,
      role:          legacyRole,
    };
  }
  if (entity === 'Manager') {
    let cells = [];
    try {
      cells = typeof row.cell === 'string' ? JSON.parse(row.cell) : (row.cell || []);
      if (!Array.isArray(cells)) cells = [];
    } catch (e) {
      cells = [];
    }
    return {
      ...base,
      name: row.name || '',
      email: row.email || '',
      role: row.role || 'manager',
      cells: cells,
      active: row.active ?? true,
    };
  }
  if (entity === 'NotificationConfig') {
    return {
      ...base,
      webhookUrl: row.webhook_url || '',
      webhookEnabled: row.webhook_enabled === true,
      emailEnabled: row.email_enabled !== false,
      dailyClosureEnabled: row.daily_closure_enabled === true,
    };
  }
  if (entity === 'WorkdayCalendar') {
    return {
      ...base,
      isWorkday: row.is_workday,
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

      // Aplica ORDER BY no banco ANTES do LIMIT para garantir que o
      // LIMIT retorne as linhas corretas (ex: as mais recentes por data).
      if (orderBy) {
        const desc = orderBy.startsWith('-');
        const field = desc ? orderBy.substring(1) : orderBy;
        // Mapeia nomes de campos legados para colunas reais do banco
        const dbField = field === 'created_date' ? 'created_at' : field;
        q = q.order(dbField, { ascending: !desc });
      }

      if (limit) q = q.limit(limit);

      const { data, error } = await q;
      if (error) throw error;

      // Já ordenados pelo banco; normaliza e retorna
      return (data || []).map((r) => normalizeFromDb(entityName, r));
    },

    create: async (payload) => {
      // Adiciona created_by automaticamente para entidades de produção
      const enriched = { ...payload };
      delete enriched.id;          // deixar o DB gerar
      delete enriched.created_date; // campo legado

      // Limpar campos auxiliares do frontend que começam com "_" (evita PGRST204)
      Object.keys(enriched).forEach((key) => {
        if (key.startsWith('_')) {
          delete enriched[key];
        }
      });

      // Normalizar campos de data para formato ISO
      if (enriched.date && typeof enriched.date === 'string' && enriched.date.length === 10) {
        // mantém yyyy-MM-dd que o PostgreSQL aceita como DATE
      }

      if (entityName === 'Cell') {
        enriched.shift_hours = {
          shift1: Number(enriched.hoursShift1 ?? 8),
          shift2: Number(enriched.hoursShift2 ?? 8),
          shift3: Number(enriched.hoursShift3 ?? 8),
        };
        delete enriched.hoursShift1;
        delete enriched.hoursShift2;
        delete enriched.hoursShift3;
      }

      if (entityName === 'Operator') {
        // Migration 018: usar colunas reais em vez de JSON em role
        // role é apenas o papel (operator/admin); registration, cells, shift, primary_cell são colunas diretas
        if (enriched.role && !enriched.role.startsWith('{')) {
          // role já é uma string simples — manter
        } else if (enriched.role?.startsWith('{')) {
          try { enriched.role = JSON.parse(enriched.role).role || 'operator'; } catch (_) { enriched.role = 'operator'; }
        } else {
          enriched.role = 'operator';
        }
        // Garantir login_name = name para que a RPC de login funcione
        enriched.login_name = enriched.login_name || enriched.name || '';
        // Normalizar cells como array postgres
        if (!Array.isArray(enriched.cells)) enriched.cells = [];
      }

      if (entityName === 'Manager') {
        const res = await users.inviteUser(
          enriched.email,
          'manager',
          enriched.name,
          '',
          null,
          JSON.stringify(enriched.cells || [])
        );
        // Sincroniza com o Resend
        supabase.functions.invoke('syncResendContact', {
          body: {
            action: 'create',
            email: enriched.email,
            name: enriched.name
          }
        }).catch(err => console.error('Erro ao sincronizar contato com Resend no create:', err));

        // Atualiza a coluna active, se necessário, já que inviteUser não a define
        if (enriched.active !== undefined) {
          await supabase.from('profiles').update({ active: enriched.active }).eq('id', res.id);
        }
        return normalizeFromDb(entityName, { ...res, active: enriched.active ?? true, cell: JSON.stringify(enriched.cells || []) });
      }

      if (entityName === 'NotificationConfig') {
        enriched.webhook_url = enriched.webhookUrl;
        enriched.webhook_enabled = enriched.webhookEnabled;
        enriched.email_enabled = enriched.emailEnabled;
        enriched.daily_closure_enabled = enriched.dailyClosureEnabled;
        delete enriched.webhookUrl;
        delete enriched.webhookEnabled;
        delete enriched.emailEnabled;
        delete enriched.dailyClosureEnabled;
      }

      if (entityName === 'WorkdayCalendar') {
        enriched.is_workday = enriched.isWorkday;
        delete enriched.isWorkday;
      }

      if (entityName === 'ProductionEntry') {
        const compatible = { ...enriched };
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const { data, error } = await supabase.from(table).insert(compatible).select().single();
          if (!error) return normalizeFromDb(entityName, data);
          const missingColumn = String(error.message || '').match(/(?:Could not find the|column)\s+['"]?([a-zA-Z0-9_]+)['"]?\s+(?:column|of)/i)?.[1];
          if (error.code !== 'PGRST204' || !missingColumn || !(missingColumn in compatible)) throw error;
          delete compatible[missingColumn];
        }
        throw new Error('Não foi possível adaptar o apontamento ao schema disponível.');
      }

      const q = entityName === 'DailyGoal'
        ? supabase.from(table).upsert(enriched, { onConflict: 'date,shift,cell' }).select().single()
        : supabase.from(table).insert(enriched).select().single();
      const { data, error } = await q;
      if (error) throw error;
      return normalizeFromDb(entityName, data);
    },

    update: async (id, payload) => {
      const clean = { ...payload };
      delete clean.id;
      delete clean.created_date;
      delete clean.created_at;

      // Limpar campos auxiliares do frontend que começam com "_" (evita PGRST204)
      Object.keys(clean).forEach((key) => {
        if (key.startsWith('_')) {
          delete clean[key];
        }
      });

      // Se for a entidade User, intercepta a alteração de senha para fazer via RPC seguro
      if (entityName === 'User') {
        const password = clean.password;
        delete clean.password;
        
        if (password) {
          const { error: rpcError } = await supabase.rpc('admin_update_user_password', {
            target_user_id: id,
            new_password: password,
          });
          if (rpcError) throw rpcError;
        }
      }

      if (entityName === 'Cell') {
        clean.shift_hours = {
          shift1: Number(clean.hoursShift1 ?? 8),
          shift2: Number(clean.hoursShift2 ?? 8),
          shift3: Number(clean.hoursShift3 ?? 8),
        };
        delete clean.hoursShift1;
        delete clean.hoursShift2;
        delete clean.hoursShift3;
      }

      if (entityName === 'Operator') {
        // Migration 018: usar colunas reais
        if (clean.role && clean.role.startsWith('{')) {
          try { clean.role = JSON.parse(clean.role).role || 'operator'; } catch (_) { clean.role = 'operator'; }
        }
        clean.login_name = clean.login_name || clean.name || '';
        if (!Array.isArray(clean.cells)) clean.cells = [];
      }

      if (entityName === 'Manager') {
        let oldEmail = clean.email;
        try {
          const { data: oldManager } = await supabase.from('profiles').select('email').eq('id', id).single();
          if (oldManager && oldManager.email) {
            oldEmail = oldManager.email;
          }
        } catch (e) {
          console.error('Erro ao buscar e-mail anterior do gestor:', e);
        }

        const res = await users.updateUser(id, {
          name: clean.name,
          email: clean.email,
          cell: JSON.stringify(clean.cells || [])
        });

        // Sincroniza com o Resend
        supabase.functions.invoke('syncResendContact', {
          body: {
            action: 'update',
            email: clean.email,
            oldEmail: oldEmail,
            name: clean.name
          }
        }).catch(err => console.error('Erro ao sincronizar contato com Resend no update:', err));

        if (clean.active !== undefined) {
          await supabase.from('profiles').update({ active: clean.active }).eq('id', id);
        }
        return normalizeFromDb(entityName, { ...res, active: clean.active ?? true, cell: JSON.stringify(clean.cells || []) });
      }

      if (entityName === 'NotificationConfig') {
        clean.webhook_url = clean.webhookUrl;
        clean.webhook_enabled = clean.webhookEnabled;
        clean.email_enabled = clean.emailEnabled;
        clean.daily_closure_enabled = clean.dailyClosureEnabled;
        delete clean.webhookUrl;
        delete clean.webhookEnabled;
        delete clean.emailEnabled;
        delete clean.dailyClosureEnabled;
      }

      if (entityName === 'WorkdayCalendar') {
        clean.is_workday = clean.isWorkday;
        delete clean.isWorkday;
      }

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
      if (entityName === 'Manager') {
        try {
          const { data: oldManager } = await supabase.from(table).select('email, name').eq('id', id).single();
          if (oldManager && oldManager.email) {
            base44.functions.invoke('syncResendContact', {
              action: 'delete',
              email: oldManager.email,
              name: oldManager.name
            }).catch(err => console.error('Erro ao remover contato do Resend:', err));
          }
        } catch (e) {
          console.error('Erro ao buscar e-mail do gestor antes de deletar:', e);
        }
      }
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
    // Valida a sessão com o servidor do Supabase para evitar "sessões fantasma"
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!user || userError) {
      const err = new Error('Authentication required');
      err.status = 401;
      throw err;
    }

    // Buscar perfil com dados de negócio da tabela profiles
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // Se erro de RLS ou perfil não existe, usa metadados do Auth como fallback
    const meta = user.user_metadata || {};
    return {
      id: user.id,
      email: user.email,
      name: profile?.name || meta.name || user.email?.split('@')[0] || '',
      role: profile?.role || meta.role || 'operator',
      cell: profile?.cell || meta.cell || '',
      permissions: profile?.permissions || meta.permissions || {
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
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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
    persistAuthSession(data.session);

    const user = data.user;
    const meta = user.user_metadata || {};
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return {
      id: user.id,
      email: user.email,
      name: profile?.name || meta.name || user.email?.split('@')[0] || '',
      role: profile?.role || meta.role || 'operator',
      cell: profile?.cell || meta.cell || '',
      permissions: profile?.permissions || meta.permissions || {
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
    clearPersistedAuthSession();
    await supabase.auth.signOut();
  },

  redirectToLogin: () => {
    window.location.replace(`${(import.meta.env.BASE_URL || '/ac-prod/').replace(/\/$/, '')}/login`);
  },

  setToken: () => { /* Gerenciado pelo Supabase Auth automaticamente */ },

  resetPasswordRequest: async (email) => {
    // Inclui o basename /ac-prod no redirectTo para GitHub Pages e produção
    const base = import.meta.env.BASE_URL || '/ac-prod/';
    const redirectTo = `${window.location.origin}${base}reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
    return { success: true };
  },

  resetPassword: async ({ newPassword }) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    return { success: true };
  },

  loginWithProvider: async (provider, path = '/') => {
    const base = (import.meta.env.BASE_URL || '/ac-prod/').replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${base}${cleanPath}` },
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

    // Criar um cliente temporário sem persistência de sessão para não deslogar o administrador atual
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const tempSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Registrar usuário normalmente usando o cliente temporário
    const { data, error } = await tempSupabase.auth.signUp({
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

    // Se o usuário já existe no Auth (identities vazia em contas com confirmação de email ativa)
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error("Este e-mail já está cadastrado no sistema. Se for necessário recriar o perfil, o usuário anterior deve ser removido primeiro.");
    }

    // 2. Atualizar perfil com campos adicionais (usando o cliente principal autenticado do admin)
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
    const { error } = await supabase.rpc('delete_user_from_auth', { target_user_id: id });
    if (error) throw error;
    return { success: true };
  },
};

// ─── Exportação principal — compatível com a API legada base44 ───────────────
export const base44 = {
  auth,
  users,
  functions: {
    invoke: async (functionName, options = {}) => {
      const hasOptionKeys = 'body' in options || 'headers' in options || 'method' in options || 'queryParams' in options;
      const invokeOptions = hasOptionKeys ? options : { body: options };
      return supabase.functions.invoke(functionName, invokeOptions);
    }
  },
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
    NotificationConfig: createEntityClient('NotificationConfig'),
    // ─── Rastreabilidade MES Leo Madeiras ──────────────────────────
    ProductionOrder: createEntityClient('ProductionOrder'),
    ProductionLot: createEntityClient('ProductionLot'),
    ProductionOrderItem: createEntityClient('ProductionOrderItem'),
    ProductionLotItem: createEntityClient('ProductionLotItem'),
    ProductionRoute: createEntityClient('ProductionRoute'),
    ProductionTag: createEntityClient('ProductionTag'),
    ProductionStageReading: createEntityClient('ProductionStageReading'),
    ProductionSearchIndex: createEntityClient('ProductionSearchIndex'),
    ReaderDevice: createEntityClient('ReaderDevice'),
    TraceabilityLog: createEntityClient('TraceabilityLog'),
    LotItem: createEntityClient('LotItem'),
    PieceInstance: createEntityClient('PieceInstance'),
    RoutingStep: createEntityClient('RoutingStep'),
    RouteTemplate: createEntityClient('RouteTemplate'),
    RouteTemplateStep: createEntityClient('RouteTemplateStep'),
    LotStepEvent: createEntityClient('LotStepEvent'),
    Package: createEntityClient('Package'),
    PackageItem: createEntityClient('PackageItem'),
    Shipment: createEntityClient('Shipment'),
    PromobIntegration: createEntityClient('PromobIntegration'),
    PromobImportBatch: createEntityClient('PromobImportBatch'),
    PromobImportDifference: createEntityClient('PromobImportDifference'),
    OfflineEventQueue: createEntityClient('OfflineEventQueue'),
    SystemAuditLog: createEntityClient('SystemAuditLog'),
    ReportSchedule: createEntityClient('ReportSchedule'),
    ReportDeliveryLog: createEntityClient('ReportDeliveryLog'),
    BackupPolicy: createEntityClient('BackupPolicy'),
    BackupFile: createEntityClient('BackupFile'),
  },
};

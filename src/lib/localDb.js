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
import { getDefaultPermissions } from '@/config/appRoutes';
import {
  getProductionMetricRule,
  getUnitLabel,
  normalizeProductionUnit,
} from '@/lib/productionUnitRules';

// ─── Mapeamento de nomes de entidade para tabelas Supabase ───────────────────
const TABLE_MAP = {
  ProductionEntry: 'production_entries',
  DailyGoal: 'production_daily_goals',
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
  EmailRecipientGroup: 'email_recipient_groups',
  EmailRecipientGroupMember: 'email_recipient_group_members',
  ReportScheduleRecipient: 'report_schedule_recipients',
  ReportScheduleRun: 'report_schedule_runs',
  ReportDelivery: 'report_deliveries',
  ReportDeliveryHistory: 'report_delivery_history',
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
    return {
      ...base,
      date: row.date?.toString?.() ?? row.date,
      cell: row.cell ?? row.cell_name ?? '',
      cell_name: row.cell_name ?? row.cell ?? '',
      area_name: row.area_name ?? row.cell_name ?? row.cell ?? '',
      hours: row.hours,
      target: Number(row.target) || 0,
      capacity: Number(row.capacity) || 0,
      metric_unit: row.metric_unit || 'pieces',
      metric_unit_label: row.metric_unit_label || getUnitLabel(row.metric_unit || 'pieces'),
    };
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

const number = (value) => Number(String(value ?? '').replace(',', '.')) || 0;

function toProductionDailyGoalPayload(payload = {}) {
  const cell = payload.cell_name || payload.cell || payload.area_name || '';
  const metricUnit = normalizeProductionUnit(
    payload.metric_unit || payload.metricUnit || payload.unit || getProductionMetricRule({ cell }).unit
  );
  const metricRule = getProductionMetricRule({ cell, metric_unit: metricUnit });

  return {
    date: payload.date,
    shift: payload.shift || '1º Turno',
    cell_name: cell,
    area_name: payload.area_name || cell,
    metric_unit: metricUnit,
    metric_unit_label: payload.metric_unit_label || getUnitLabel(metricUnit),
    metric_name: payload.metric_name || metricRule.metricName,
    capacity: number(payload.capacity ?? payload.planned_capacity),
    target: number(payload.target),
  };
}

function mapDailyGoalCondition(key, value) {
  if (key === 'cell') return ['cell_name', value];
  if (key === 'metricUnit') return ['metric_unit', normalizeProductionUnit(value)];
  if (key === 'metric_unit') return ['metric_unit', normalizeProductionUnit(value)];
  return [key, value];
}

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

        // Garante que a aba Gestores seja a fonte oficial para IA, escopo e e-mails.
        await supabase
          .from('profiles')
          .update({
            role: 'manager',
            cell: JSON.stringify(enriched.cells || []),
            managed_cells: enriched.cells || [],
            active: enriched.active ?? true,
          })
          .eq('id', res.id);
        return normalizeFromDb(entityName, { ...res, active: enriched.active ?? true, cell: JSON.stringify(enriched.cells || []), managed_cells: enriched.cells || [] });
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

      if (entityName === 'MonthlyGoal') {
        enriched.shift = enriched.shift || 'Todos os turnos';
      }

      if (entityName === 'DailyGoal') {
        const dbGoal = toProductionDailyGoalPayload(enriched);
        const { data, error } = await supabase
          .from(table)
          .upsert(dbGoal, { onConflict: 'date,shift,cell_name,metric_unit' })
          .select()
          .single();
        if (error) throw error;
        return normalizeFromDb(entityName, data);
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

      const q = supabase.from(table).insert(enriched).select().single();
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
          role: 'manager',
          cell: JSON.stringify(clean.cells || []),
          managed_cells: clean.cells || [],
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
        return normalizeFromDb(entityName, { ...res, active: clean.active ?? true, cell: JSON.stringify(clean.cells || []), managed_cells: clean.cells || [] });
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

      if (entityName === 'MonthlyGoal') {
        clean.shift = clean.shift || 'Todos os turnos';
      }

      if (entityName === 'DailyGoal') {
        const { data: current, error: currentError } = await supabase
          .from(table)
          .select('*')
          .eq('id', id)
          .single();
        if (currentError) throw currentError;
        const dbGoal = toProductionDailyGoalPayload({
          ...normalizeFromDb(entityName, current),
          ...clean,
        });
        const { data, error } = await supabase
          .from(table)
          .update(dbGoal)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return normalizeFromDb(entityName, data);
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
          const [dbKey, dbValue] = entityName === 'DailyGoal'
            ? mapDailyGoalCondition(key, val)
            : [key, val];
          q = q.eq(dbKey, dbValue);
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
const requireRegisteredProfile = async (user) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile) {
    const accessError = new Error('Este e-mail ainda não foi cadastrado pelo administrador.');
    accessError.code = 'USER_NOT_REGISTERED';
    throw accessError;
  }
  if (profile.active === false) {
    const accessError = new Error('Esta conta está desativada. Procure o administrador.');
    accessError.code = 'USER_INACTIVE';
    throw accessError;
  }

  return {
    id: user.id,
    email: profile.email || user.email,
    name: profile.name,
    role: profile.role,
    cell: profile.cell || '',
    permissions: profile.permissions || getDefaultPermissions(profile.role),
    dashboard_layout: profile.dashboard_layout || null,
    managed_cells: profile.managed_cells || [],
    active: true,
  };
};

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
    return requireRegisteredProfile(user);
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
    try {
      const profile = await requireRegisteredProfile(data.user);
      persistAuthSession(data.session);
      return profile;
    } catch (profileError) {
      clearPersistedAuthSession();
      await supabase.auth.signOut();
      throw profileError;
    }
  },

  register: async () => {
    throw new Error('O cadastro público está desativado. Solicite acesso a um administrador.');
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
      options: {
        redirectTo: `${window.location.origin}${base}${cleanPath}`,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
    if (error) throw new Error(error.message);
  },
};

// ─── Users management (admin only — operações seguras via RLS) ───────────────
const users = {
  inviteUser: async (email, role, name = '', password = '', permissions = null, cell = '') => {
    const defaultPermissions = getDefaultPermissions(role);
    const finalPermissions = permissions || defaultPermissions;
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'create',
        email,
        password,
        name: name || email.split('@')[0],
        role,
        permissions: finalPermissions,
        cell,
      },
    });

    if (error) {
      let message = error.message;
      try {
        const details = await error.context?.json();
        message = details?.error || details?.message || message;
      } catch { /* resposta sem JSON */ }
      throw new Error(message || 'Não foi possível criar o usuário.');
    }
    if (!data?.success) throw new Error(data?.error || 'Não foi possível criar o usuário.');
    return data.user;
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
    EmailRecipientGroup: createEntityClient('EmailRecipientGroup'),
    EmailRecipientGroupMember: createEntityClient('EmailRecipientGroupMember'),
    ReportScheduleRecipient: createEntityClient('ReportScheduleRecipient'),
    ReportScheduleRun: createEntityClient('ReportScheduleRun'),
    ReportDelivery: createEntityClient('ReportDelivery'),
    ReportDeliveryHistory: createEntityClient('ReportDeliveryHistory'),
    BackupPolicy: createEntityClient('BackupPolicy'),
    BackupFile: createEntityClient('BackupFile'),
  },
};

import { supabase } from '@/lib/supabaseClient';

const BUILT_IN_CAPABILITIES = Object.freeze([
  {
    code: 'lot_tracking',
    label: 'Rastrear lote geral e lote de cliente',
    actions: ['search_production', 'navigate'],
    routes: ['/integridade-lote', '/acompanhamento-lotes', '/rastreabilidade'],
    permissions: ['view_traceability', 'ai_operations', 'view_reports'],
  },
  {
    code: 'production_reports',
    label: 'Gerar relatórios produtivos, OEE, integridade e previsão de lotes',
    actions: ['generate_report'],
    routes: ['/relatorios', '/ia-operacional'],
    permissions: ['view_reports', 'ai_operations'],
  },
  {
    code: 'email_reports',
    label: 'Enviar e agendar relatórios para gestores cadastrados',
    actions: ['send_report_email', 'schedule_report_email', 'list_schedules', 'show_email_logs'],
    routes: ['/usuarios', '/ia-operacional'],
    permissions: ['manage_automations', 'ai_operations'],
  },
]);

function hasPermission(user, names = []) {
  if (user?.role === 'admin') return true;
  if (user?.role === 'manager') return true;
  return names.some((name) => user?.permissions?.[name] === true);
}

function fallbackCapabilities(user) {
  return BUILT_IN_CAPABILITIES.filter((capability) =>
    hasPermission(user, capability.permissions)
  );
}

export async function listAiCapabilities(user) {
  try {
    const { data, error } = await supabase.rpc('get_ai_capability_context');
    if (error) throw error;
    const capabilities = Array.isArray(data) ? data : (data?.capabilities || []);
    return capabilities.length ? capabilities : fallbackCapabilities(user);
  } catch {
    return fallbackCapabilities(user);
  }
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') return {};
  const forbidden = /token|secret|password|authorization|api[_-]?key/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 500) : item])
  );
}

export async function recordAiActionRun({
  user,
  action,
  capabilityCode,
  status = 'completed',
  entityType,
  entityId,
  metadata = {},
  errorMessage = null,
} = {}) {
  try {
    await supabase.from('ai_action_runs').insert({
      user_id: user?.id || null,
      action,
      capability_code: capabilityCode || null,
      status,
      entity_type: entityType || null,
      entity_id: entityId ? String(entityId) : null,
      metadata: sanitizeMetadata(metadata),
      error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
      completed_at: status === 'processing' ? null : new Date().toISOString(),
    });
  } catch {
    // Auditoria dedicada é aditiva; ai_system_logs permanece como fallback.
  }
}


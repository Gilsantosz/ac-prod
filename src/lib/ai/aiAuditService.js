import { supabase } from '@/lib/supabaseClient';

export function isAiSchemaUnavailable(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('pgrst205')
    || text.includes('schema cache')
    || text.includes('does not exist')
    || text.includes('could not find the table');
}

async function insertOptional(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select().maybeSingle();
  if (!error) return { data, persisted: true, warning: '' };
  if (isAiSchemaUnavailable(error)) {
    return {
      data: null,
      persisted: false,
      warning: 'A estrutura de auditoria da IA ainda não foi publicada no Supabase.',
    };
  }
  return { data: null, persisted: false, warning: error.message };
}

export async function recordAiRequest({
  user,
  requestType = 'question',
  prompt,
  intent,
  filters = {},
  responseSummary = '',
  sourceTables = [],
  status = 'completed',
  errorMessage = null,
  traceId,
  durationMs,
}) {
  return insertOptional('ai_requests', {
    user_id: user?.id,
    request_type: requestType,
    prompt: String(prompt || '').slice(0, 5000),
    normalized_intent: intent || null,
    filters,
    response_summary: String(responseSummary || '').slice(0, 12000),
    source_tables: sourceTables,
    status,
    error_message: errorMessage,
    trace_id: traceId,
    duration_ms: durationMs,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  });
}

export async function recordAiEvent({
  user,
  traceId,
  level = 'info',
  event,
  entity,
  entityId,
  message,
  metadata = {},
  success = true,
}) {
  const result = await insertOptional('ai_system_logs', {
    user_id: user?.id,
    trace_id: traceId,
    level,
    event,
    entity: entity || null,
    entity_id: entityId || null,
    message: message || null,
    metadata,
    success,
  });

  if (!result.persisted) {
    await insertOptional('system_audit_logs', {
      user_id: user?.id,
      user_name: user?.name,
      user_email: user?.email,
      user_role: user?.role,
      action: `ai.${event}`,
      entity: entity || 'ai_operations',
      entity_id: entityId || traceId || null,
      page: 'IA Operacional',
      route: '/ia-operacional',
      method: 'client',
      metadata: { ...metadata, trace_id: traceId },
      success,
      error_message: success ? null : message,
    });
  }

  return result;
}

export async function listAiLogs(limit = 100) {
  const { data, error } = await supabase
    .from('ai_system_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!error) return { data: data || [], warning: '' };
  if (isAiSchemaUnavailable(error)) return { data: [], warning: 'Publique a migração 013 para habilitar os logs dedicados.' };
  throw error;
}


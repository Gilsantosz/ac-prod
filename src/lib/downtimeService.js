/**
 * AC.Prod MES — Serviço de Registro de Paradas Operacionais na Coleta
 * Fonte oficial: tabela occurrences
 */

import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';

export const DEFAULT_DOWNTIME_REASONS = [
  { id: 'reason-1', code: 'MAQ-MANUT', name: 'Máquinas em manutenção', category: 'Manutenção', active: true },
  { id: 'reason-2', code: 'MAQ-SEM-DEF', name: 'Máquina parada sem defeito prévio', category: 'Operacional', active: true },
  { id: 'reason-3', code: 'SET-AJUSTE', name: 'Ajuste de setup', category: 'Setup', active: true },
  { id: 'reason-4', code: 'PERS-BANHEIRO', name: 'Ida ao banheiro', category: 'Pessoal', active: true },
  { id: 'reason-5', code: 'UTIL-ENERGIA', name: 'Queda de energia', category: 'Utilidades', active: true },
  { id: 'reason-6', code: 'REFEIT-JANTA', name: 'Parada para janta', category: 'Intervalo', active: true },
  { id: 'reason-7', code: 'MAT-FALTA', name: 'Falta de matéria-prima / material', category: 'Abastecimento', active: true },
  { id: 'reason-8', code: 'MANUT-FERRAMENTA', name: 'Troca de ferramenta / lâmina', category: 'Manutenção', active: true }
];

/**
 * Busca o catálogo de motivos de parada.
 */
export async function getDowntimeReasons({ activeOnly = true } = {}) {
  try {
    let query = supabase
      .from('downtime_reason_catalog')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return DEFAULT_DOWNTIME_REASONS;
    }
    return data;
  } catch (err) {
    console.warn('Usando catálogo padrão de motivos de parada:', err);
    return DEFAULT_DOWNTIME_REASONS;
  }
}

/**
 * Verifica se existe uma parada ativa na máquina ou célula atual.
 */
export async function getActiveDowntime({ machineId = null, cellId = null } = {}) {
  if (!machineId && !cellId) return null;

  let query = supabase
    .from('occurrences')
    .select('*')
    .eq('status', 'open')
    .eq('occurrence_type', 'downtime');

  if (machineId) {
    query = query.eq('machine_id', machineId);
  } else if (cellId) {
    query = query.eq('cell_id', cellId);
  }

  try {
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== 'PGRST116') {
      console.warn('Verificação de parada ativa ignorada:', error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('Erro ao consultar parada ativa:', err);
    return null;
  }
}

/**
 * RPC: Iniciar Parada Agora (Cria ocorrência aberta com cronômetro).
 */
export async function startDowntime({
  downtimeReasonId = null,
  reason = 'Parada na Coleta',
  cellId = null,
  cellName = 'Geral',
  machineId = null,
  operatorId = null,
  operatorName = 'Operador',
  shift = '1',
  notes = '',
  clientEventId = null
}) {
  const { data, error } = await supabase.rpc('start_production_downtime', {
    p_payload: {
      downtime_reason_id: downtimeReasonId,
      reason,
      cell_id: cellId,
      cell_name: cellName,
      machine_id: machineId,
      operator_id: operatorId,
      operator_name: operatorName,
      shift,
      notes,
      client_event_id: clientEventId || crypto.randomUUID()
    }
  });

  if (error) throw error;

  await auditLog(
    'downtime_started',
    'occurrences',
    data.occurrence_id,
    { reason, cellName, machineId, operatorName }
  );

  return data;
}

/**
 * RPC: Encerrar Parada Ativa.
 */
export async function finishDowntime(occurrenceId, { notes = '', endedAt = null } = {}) {
  if (!occurrenceId) throw new Error('ID da ocorrência é obrigatório.');

  const { data, error } = await supabase.rpc('finish_production_downtime', {
    p_occurrence_id: occurrenceId,
    p_payload: {
      notes,
      ended_at: endedAt
    }
  });

  if (error) throw error;

  await auditLog(
    'downtime_finished',
    'occurrences',
    occurrenceId,
    { duration_minutes: data.duration_minutes, notes }
  );

  return data;
}

/**
 * RPC: Registrar Parada Passada (Início e fim preenchidos).
 */
export async function registerPastDowntime({
  downtimeReasonId = null,
  reason = 'Parada Registrada',
  startedAt,
  endedAt,
  cellId = null,
  cellName = 'Geral',
  machineId = null,
  operatorId = null,
  operatorName = 'Operador',
  shift = '1',
  notes = '',
  clientEventId = null
}) {
  if (!startedAt || !endedAt) throw new Error('Início e fim são obrigatórios para paradas passadas.');

  const { data, error } = await supabase.rpc('register_production_downtime', {
    p_payload: {
      downtime_reason_id: downtimeReasonId,
      reason,
      started_at: startedAt,
      ended_at: endedAt,
      cell_id: cellId,
      cell_name: cellName,
      machine_id: machineId,
      operator_id: operatorId,
      operator_name: operatorName,
      shift,
      notes,
      client_event_id: clientEventId || crypto.randomUUID()
    }
  });

  if (error) throw error;

  await auditLog(
    'past_downtime_registered',
    'occurrences',
    data.occurrence_id,
    { reason, startedAt, endedAt }
  );

  return data;
}

/**
 * RPC: Corrigir Lançamento de Parada.
 */
export async function correctDowntime(occurrenceId, { reason, startedAt, endedAt, durationMinutes, notes }) {
  if (!occurrenceId) throw new Error('ID da ocorrência é obrigatório.');

  const { data, error } = await supabase.rpc('correct_production_downtime', {
    p_occurrence_id: occurrenceId,
    p_payload: {
      reason,
      started_at: startedAt,
      ended_at: endedAt,
      duration_minutes: durationMinutes,
      notes
    }
  });

  if (error) throw error;

  await auditLog(
    'downtime_corrected',
    'occurrences',
    occurrenceId,
    { reason, notes }
  );

  return data;
}

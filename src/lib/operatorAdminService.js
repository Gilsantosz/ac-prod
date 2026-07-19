import { supabase } from '@/lib/supabaseClient';

/**
 * Serviço de administração de operadores (Cadastro, Vincular Célula/Máquina, Ledger de Acessos).
 */

export async function fetchOperators() {
  const { data, error } = await supabase
    .from('operators')
    .select(`
      *,
      primary_cell:cells!primary_cell_id(id, name),
      primary_machine:production_machines!primary_machine_id(id, name),
      cell_assignments:operator_cell_assignments(cell_id, is_primary, active, cells(name)),
      machine_assignments:operator_machine_assignments(machine_id, is_primary, active, production_machines(name))
    `)
    .order('name');

  if (error) {
    console.error('Erro ao buscar operadores:', error);
    throw error;
  }

  return data || [];
}

export async function createOperator(operatorData) {
  return saveOperator(null, operatorData);
}

export async function updateOperator(id, operatorData) {
  return saveOperator(id, operatorData);
}

export async function unlockOperator(id) {
  const { data, error } = await supabase.rpc('admin_unlock_operator', {
    p_operator_id: id,
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Não foi possível desbloquear o operador.');
  return data;
}

export async function fetchAccessAttempts(loginName = null) {
  let query = supabase
    .from('operator_access_attempts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (loginName) {
    query = query.eq('login_name_input', loginName);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function saveOperator(operatorId, operatorData) {
  const { data, error } = await supabase.rpc('admin_upsert_operator', {
    p_operator_id: operatorId,
    p_data: {
      ...operatorData,
      name: operatorData.name?.trim(),
      login_name: operatorData.login_name?.trim().toLowerCase().replace(/\s+/g, '.'),
      registration: operatorData.registration?.trim() || null,
      cell_ids: operatorData.cell_ids || [],
      machine_ids: operatorData.machine_ids || [],
    },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Não foi possível salvar o operador.');
  return data.operator;
}

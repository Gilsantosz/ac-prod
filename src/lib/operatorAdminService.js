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
  const { name, login_name, registration, shift, primary_cell_id, primary_machine_id } = operatorData;

  const { data, error } = await supabase
    .from('operators')
    .insert([{
      name: name.trim(),
      login_name: login_name.trim(),
      registration: registration.trim(),
      shift: shift || null,
      primary_cell_id: primary_cell_id || null,
      primary_machine_id: primary_machine_id || null,
      active: true
    }])
    .select()
    .single();

  if (error) throw error;

  await updateAssignments(
    data.id, 
    operatorData.cell_ids || [], 
    operatorData.machine_ids || [], 
    primary_cell_id, 
    primary_machine_id
  );

  return data;
}

export async function updateOperator(id, operatorData) {
  const { name, login_name, registration, shift, primary_cell_id, primary_machine_id, active } = operatorData;

  const updatePayload = {
    name: name.trim(),
    login_name: login_name.trim(),
    shift: shift || null,
    primary_cell_id: primary_cell_id || null,
    primary_machine_id: primary_machine_id || null,
    active: active !== false
  };

  if (registration && registration.trim()) {
    updatePayload.registration = registration.trim();
  }

  const { data, error } = await supabase
    .from('operators')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  await updateAssignments(
    id, 
    operatorData.cell_ids || [], 
    operatorData.machine_ids || [], 
    primary_cell_id, 
    primary_machine_id
  );

  return data;
}

export async function unlockOperator(id) {
  const { data, error } = await supabase
    .from('operators')
    .update({
      failed_login_count: 0,
      locked_until: null
    })
    .eq('id', id);

  if (error) throw error;
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

async function updateAssignments(operatorId, cellIds, machineIds, primaryCellId, primaryMachineId) {
  // 1. Limpar e re-inserir vínculos com Células
  await supabase
    .from('operator_cell_assignments')
    .delete()
    .eq('operator_id', operatorId);

  if (cellIds.length > 0) {
    const cellInserts = cellIds.map(cellId => ({
      operator_id: operatorId,
      cell_id: cellId,
      is_primary: cellId === primaryCellId,
      active: true
    }));

    const { error: cellErr } = await supabase
      .from('operator_cell_assignments')
      .insert(cellInserts);
    if (cellErr) throw cellErr;
  }

  // 2. Limpar e re-inserir vínculos com Máquinas
  await supabase
    .from('operator_machine_assignments')
    .delete()
    .eq('operator_id', operatorId);

  if (machineIds.length > 0) {
    const machInserts = machineIds.map(machId => ({
      operator_id: operatorId,
      machine_id: machId,
      is_primary: machId === primaryMachineId,
      active: true
    }));

    const { error: machErr } = await supabase
      .from('operator_machine_assignments')
      .insert(machInserts);
    if (machErr) throw machErr;
  }
}

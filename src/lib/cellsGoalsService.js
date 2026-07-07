import { supabase } from '@/lib/supabaseClient';

/**
 * Service de gerenciamento de Células, Máquinas/Postos e Metas.
 * Encapsula todas as operações no Supabase.
 */

// ─── CÉLULAS ─────────────────────────────────────────────────────────────────

export async function getCells() {
  const { data, error } = await supabase
    .from('cells')
    .select('*')
    .order('name');
  if (error) throw error;
  
  // Normaliza shift_hours para o formato esperado pelo frontend
  return (data || []).map(row => {
    const sh = row.shift_hours || {};
    return {
      ...row,
      hoursShift1: Number(sh.shift1 ?? 8),
      hoursShift2: Number(sh.shift2 ?? 8),
      hoursShift3: Number(sh.shift3 ?? 8),
    };
  });
}

export async function getActiveCells() {
  const { data, error } = await supabase
    .from('cells')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  
  return (data || []).map(row => {
    const sh = row.shift_hours || {};
    return {
      ...row,
      hoursShift1: Number(sh.shift1 ?? 8),
      hoursShift2: Number(sh.shift2 ?? 8),
      hoursShift3: Number(sh.shift3 ?? 8),
    };
  });
}

export async function createCell(payload) {
  const dbPayload = {
    name: payload.name,
    description: payload.description ?? '',
    notes: payload.notes ?? '',
    active: payload.active !== false,
    shift_hours: {
      shift1: Number(payload.hoursShift1 ?? 8),
      shift2: Number(payload.hoursShift2 ?? 8),
      shift3: Number(payload.hoursShift3 ?? 8),
    }
  };

  const { data, error } = await supabase
    .from('cells')
    .insert([dbPayload])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCell(id, payload) {
  const { data: current, error: currentError } = await supabase
    .from('cells')
    .select('*')
    .eq('id', id)
    .single();
  if (currentError) throw currentError;

  const hasShiftHours = ['hoursShift1', 'hoursShift2', 'hoursShift3'].some((key) => key in payload);
  const currentShiftHours = current?.shift_hours || {};
  const dbPayload = {};

  if ('name' in payload) dbPayload.name = payload.name;
  if ('description' in payload) dbPayload.description = payload.description ?? '';
  if ('notes' in payload) dbPayload.notes = payload.notes ?? '';
  if ('active' in payload) dbPayload.active = payload.active !== false;
  if (hasShiftHours) {
    dbPayload.shift_hours = {
      shift1: Number(payload.hoursShift1 ?? currentShiftHours.shift1 ?? 8),
      shift2: Number(payload.hoursShift2 ?? currentShiftHours.shift2 ?? 8),
      shift3: Number(payload.hoursShift3 ?? currentShiftHours.shift3 ?? 8),
    };
  }

  const { data, error } = await supabase
    .from('cells')
    .update(dbPayload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  const oldName = String(current?.name || '').trim();
  const newName = String(data?.name || '').trim();
  if (oldName && newName && oldName !== newName) {
    await cascadeCellNameChange(oldName, newName);
  }

  return data;
}

async function cascadeCellNameChange(oldName, newName) {
  const updateResult = async (query) => {
    const { error } = await query;
    if (error && !/schema cache|does not exist|column/i.test(error.message || '')) {
      throw error;
    }
  };

  await Promise.all([
    updateResult(supabase.from('production_machines').update({ cell_name: newName }).eq('cell_name', oldName)),
    updateResult(supabase.from('production_daily_goals').update({ cell_name: newName, area_name: newName }).eq('cell_name', oldName)),
    updateResult(supabase.from('daily_goals').update({ cell: newName }).eq('cell', oldName)),
    updateResult(supabase.from('monthly_goals').update({ cell: newName }).eq('cell', oldName)),
    updateResult(supabase.from('workday_calendar').update({ cell: newName }).eq('cell', oldName)),
  ]);

  const [operatorsRes, profilesRes] = await Promise.all([
    supabase.from('operators').select('id, primary_cell, cells'),
    supabase.from('profiles').select('id, cell, managed_cells'),
  ]);

  if (operatorsRes.error && !/schema cache|does not exist|column/i.test(operatorsRes.error.message || '')) {
    throw operatorsRes.error;
  }
  if (profilesRes.error && !/schema cache|does not exist|column/i.test(profilesRes.error.message || '')) {
    throw profilesRes.error;
  }

  const affectedOperators = (operatorsRes.data || []).filter((operator) =>
    operator.primary_cell === oldName || (Array.isArray(operator.cells) && operator.cells.includes(oldName))
  );
  const affectedProfiles = (profilesRes.data || []).filter((profile) =>
    profile.cell === oldName || (Array.isArray(profile.managed_cells) && profile.managed_cells.includes(oldName))
  );

  await Promise.all(affectedOperators.map((operator) => {
    const cells = Array.isArray(operator.cells)
      ? operator.cells.map((cell) => (cell === oldName ? newName : cell))
      : [];
    return updateResult(supabase.from('operators').update({
      primary_cell: operator.primary_cell === oldName ? newName : operator.primary_cell,
      cells,
    }).eq('id', operator.id));
  }));

  await Promise.all(affectedProfiles.map((profile) => {
    const managedCells = Array.isArray(profile.managed_cells)
      ? profile.managed_cells.map((cell) => (cell === oldName ? newName : cell))
      : [];
    return updateResult(supabase.from('profiles').update({
      cell: profile.cell === oldName ? newName : profile.cell,
      managed_cells: managedCells,
    }).eq('id', profile.id));
  }));
}

export async function deactivateCell(id) {
  const { data, error } = await supabase
    .from('cells')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCell(id) {
  const { error } = await supabase
    .from('cells')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}


// ─── MÁQUINAS/POSTOS ─────────────────────────────────────────────────────────

export async function getWorkstations() {
  const { data, error } = await supabase
    .from('production_machines')
    .select('*')
    .order('cell_name')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function getWorkstationsByCell(cellName) {
  if (!cellName) return [];
  const { data, error } = await supabase
    .from('production_machines')
    .select('*')
    .eq('cell_name', cellName)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createWorkstation(payload) {
  const { data, error } = await supabase
    .from('production_machines')
    .insert([{
      name: payload.name,
      cell_name: payload.cell_name,
      station_name: payload.station_name || null,
      metric_unit: payload.metric_unit || 'peças',
      active: payload.active !== false
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkstation(id, payload) {
  const { data, error } = await supabase
    .from('production_machines')
    .update({
      name: payload.name,
      cell_name: payload.cell_name,
      station_name: payload.station_name || null,
      metric_unit: payload.metric_unit || 'peças',
      active: payload.active !== false
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateWorkstation(id) {
  const { data, error } = await supabase
    .from('production_machines')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWorkstation(id) {
  const { error } = await supabase
    .from('production_machines')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}


// ─── METAS PRODUTIVAS ────────────────────────────────────────────────────────

export async function getProductionGoals(date) {
  const query = supabase
    .from('production_daily_goals')
    .select('*')
    .order('shift')
    .order('cell_name');

  if (date) {
    query.eq('date', date);
  }

  const { data, error } = await query;
  if (error) {
    if (/schema cache|does not exist/i.test(error.message || '')) return [];
    throw error;
  }
  return data || [];
}

export async function createProductionGoal(payload) {
  const { data, error } = await supabase
    .from('production_daily_goals')
    .insert([{
      date: payload.date,
      shift: payload.shift,
      cell_name: payload.cell_name,
      area_name: payload.cell_name,
      metric_unit: payload.metric_unit || 'peças',
      metric_unit_label: payload.metric_unit_label || 'peças',
      metric_name: payload.metric_name || 'Peças Produzidas',
      capacity: Number(payload.capacity || 0),
      target: Number(payload.target || 0)
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProductionGoal(id, payload) {
  const { data, error } = await supabase
    .from('production_daily_goals')
    .update({
      date: payload.date,
      shift: payload.shift,
      cell_name: payload.cell_name,
      area_name: payload.cell_name,
      metric_unit: payload.metric_unit || 'peças',
      metric_unit_label: payload.metric_unit_label || 'peças',
      metric_name: payload.metric_name || 'Peças Produzidas',
      capacity: Number(payload.capacity || 0),
      target: Number(payload.target || 0)
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProductionGoal(id) {
  const { error } = await supabase
    .from('production_daily_goals')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}


// ─── RESUMO / KPIs ───────────────────────────────────────────────────────────

export async function getCellsGoalsSummary(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);

  const [cellsRes, machinesRes, goalsRes] = await Promise.all([
    supabase.from('cells').select('id, name, active'),
    supabase.from('production_machines').select('id, active'),
    supabase.from('production_daily_goals').select('id, cell_name').eq('date', date)
  ]);

  if (cellsRes.error) throw cellsRes.error;
  if (machinesRes.error) throw machinesRes.error;
  if (goalsRes.error) throw goalsRes.error;

  const totalCells = cellsRes.data?.length || 0;
  const activeCells = cellsRes.data?.filter(c => c.active !== false).length || 0;
  const totalMachines = machinesRes.data?.length || 0;
  const activeGoals = goalsRes.data?.length || 0;

  // Células ativas que não têm meta configurada para a data
  const cellsWithGoal = new Set((goalsRes.data || []).map(g => g.cell_name));
  const cellsWithoutGoal = (cellsRes.data || [])
    .filter(c => c.active !== false && !cellsWithGoal.has(c.name))
    .length;

  return {
    totalCells,
    activeCells,
    totalMachines,
    activeGoals,
    cellsWithoutGoal
  };
}

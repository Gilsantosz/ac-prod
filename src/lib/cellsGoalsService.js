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
    description: payload.description || null,
    notes: payload.notes || null,
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
  const dbPayload = {
    name: payload.name,
    description: payload.description || null,
    notes: payload.notes || null,
    active: payload.active !== false,
    shift_hours: {
      shift1: Number(payload.hoursShift1 ?? 8),
      shift2: Number(payload.hoursShift2 ?? 8),
      shift3: Number(payload.hoursShift3 ?? 8),
    }
  };

  const { data, error } = await supabase
    .from('cells')
    .update(dbPayload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
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

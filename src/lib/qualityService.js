/**
 * AC.Prod MES — Serviço de Gestão da Qualidade Industrial
 * Catálogo de Defeitos 6M, Não Conformidades (NC), Ações 5W2H, Pareto, FPY e Controle Estatístico (SPC)
 */

import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';

export const SIX_M_CATEGORIES = [
  'Máquina',
  'Método',
  'Material',
  'Mão de obra',
  'Medição',
  'Meio ambiente'
];

export const NC_DISPOSITION_LABELS = {
  scrap: { label: 'Refugo', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
  rework: { label: 'Retrabalho', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  replacement: { label: 'Reposição', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  use_as_is: { label: 'Uso Como Está', color: 'bg-sky-500/10 text-sky-600 border-sky-500/20' },
  hold: { label: 'Quarentena / Retido', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' }
};

export const NC_STATUS_LABELS = {
  open: { label: 'Aberta', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
  contained: { label: 'Contida', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  analysis: { label: 'Em Análise', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  action_plan: { label: 'Plano de Ação', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  verification: { label: 'Em Verificação', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
  closed: { label: 'Encerrada', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' }
};

/**
 * Catálogo de Defeitos: Busca a lista completa de defeitos configurados.
 */
export async function getDefectCatalog({ activeOnly = true, category = null, sixM = null } = {}) {
  let query = supabase
    .from('quality_defect_catalog')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (activeOnly) {
    query = query.eq('active', true);
  }
  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  if (sixM && sixM !== 'all') {
    query = query.eq('six_m_category', sixM);
  }

  try {
    const { data, error } = await query;
    if (error) {
      console.warn('Aviso ao buscar catálogo de defeitos, utilizando fallback estático:', error.message);
      return STATIC_DEFECTS;
    }
    return (data && data.length > 0) ? data : STATIC_DEFECTS;
  } catch (err) {
    console.warn('Falha na requisição do catálogo de defeitos, utilizando fallback estático:', err);
    return STATIC_DEFECTS;
  }
}

const STATIC_DEFECTS = [
  { id: 'def-001', code: 'DEF-001', name: 'MDF riscado', category: 'Superfície', six_m_category: 'Material', default_severity: 'low' },
  { id: 'def-002', code: 'DEF-002', name: 'Peça lascada', category: 'Bordas e Cantos', six_m_category: 'Material', default_severity: 'medium' },
  { id: 'def-003', code: 'DEF-003', name: 'Erro de corte', category: 'Dimensionamento', six_m_category: 'Máquina', default_severity: 'high' },
  { id: 'def-004', code: 'DEF-004', name: 'Erro de medida', category: 'Dimensionamento', six_m_category: 'Medição', default_severity: 'high' },
  { id: 'def-005', code: 'DEF-005', name: 'Erro de furação', category: 'Usinagem', six_m_category: 'Máquina', default_severity: 'medium' },
  { id: 'def-006', code: 'DEF-006', name: 'Erro de CNC', category: 'Usinagem', six_m_category: 'Método', default_severity: 'high' },
  { id: 'def-007', code: 'DEF-007', name: 'Borda errada', category: 'Fita de Borda', six_m_category: 'Material', default_severity: 'medium' },
  { id: 'def-008', code: 'DEF-008', name: 'Borda descolada', category: 'Fita de Borda', six_m_category: 'Máquina', default_severity: 'medium' },
  { id: 'def-009', code: 'DEF-009', name: 'Peça quebrada', category: 'Estrutura', six_m_category: 'Mão de obra', default_severity: 'critical' },
  { id: 'def-010', code: 'DEF-010', name: 'Peça perdida', category: 'Logística Interna', six_m_category: 'Mão de obra', default_severity: 'high' },
  { id: 'def-011', code: 'DEF-011', name: 'Falha de acabamento', category: 'Acabamento', six_m_category: 'Mão de obra', default_severity: 'medium' },
  { id: 'def-012', code: 'DEF-012', name: 'Umidade / Empenamento', category: 'Armazenamento', six_m_category: 'Meio ambiente', default_severity: 'high' },
  { id: 'def-099', code: 'DEF-099', name: 'Outro', category: 'Geral', six_m_category: 'Método', default_severity: 'medium' }
];

/**
 * Catálogo de Defeitos: Salva/Atualiza um defeito.
 */
export async function saveDefectInCatalog(defect) {
  const isEdit = !!defect.id;
  const payload = {
    code: defect.code,
    name: defect.name,
    description: defect.description || '',
    category: defect.category || 'Geral',
    six_m_category: defect.six_m_category || 'Método',
    default_severity: defect.default_severity || 'medium',
    active: defect.active !== false,
    display_order: Number(defect.display_order) || 0,
    updated_at: new Date().toISOString()
  };

  let result;
  if (isEdit) {
    const { data, error } = await supabase
      .from('quality_defect_catalog')
      .update(payload)
      .eq('id', defect.id)
      .select()
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await supabase
      .from('quality_defect_catalog')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    result = data;
  }

  await auditLog(
    isEdit ? 'defect_updated' : 'defect_created',
    'quality_defect_catalog',
    result.id,
    payload
  );

  return result;
}

/**
 * Não Conformidades: Lista com filtros e paginação.
 */
export async function getNonconformities({
  status = null,
  disposition = null,
  severity = null,
  defectId = null,
  cellId = null,
  lotCode = null,
  orderNumber = null,
  search = null,
  limit = 50,
  offset = 0
} = {}) {
  let query = supabase
    .from('quality_nonconformities')
    .select('*', { count: 'exact' });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (disposition && disposition !== 'all') {
    query = query.eq('disposition', disposition);
  }
  if (severity && severity !== 'all') {
    query = query.eq('severity', severity);
  }
  if (defectId) {
    query = query.eq('defect_id', defectId);
  }
  if (cellId) {
    query = query.eq('cell_id', cellId);
  }
  if (lotCode) {
    query = query.ilike('lot_code', `%${lotCode}%`);
  }
  if (orderNumber) {
    query = query.ilike('order_number', `%${orderNumber}%`);
  }
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`nc_code.ilike.%${term}%,defect_name.ilike.%${term}%,lot_code.ilike.%${term}%,order_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
  }

  query = query.order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('Erro ao buscar não conformidades:', error);
    throw error;
  }

  const nonconformities = (data || []).map((nc) => ({
    ...nc,
    detected_at: nc.detected_at || nc.created_at,
    actions: [],
  }));

  if (nonconformities.length > 0) {
    const ncIds = nonconformities.map((nc) => nc.id);
    const { data: actions, error: actionsError } = await supabase
      .from('quality_actions')
      .select('id, nonconformity_id, action_type, what, status, efficacy_verified, when_deadline, who_owner_name')
      .in('nonconformity_id', ncIds)
      .order('created_at', { ascending: false });

    if (!actionsError) {
      const actionsByNc = (actions || []).reduce((grouped, action) => {
        if (!grouped[action.nonconformity_id]) grouped[action.nonconformity_id] = [];
        grouped[action.nonconformity_id].push(action);
        return grouped;
      }, {});

      nonconformities.forEach((nc) => {
        nc.actions = actionsByNc[nc.id] || [];
      });
    }
  }

  return {
    nonconformities,
    count: count || 0
  };
}

/**
 * Não Conformidades: Encerra uma Não Conformidade.
 */
export async function closeNonconformity(ncId, { notes = '' } = {}) {
  if (!ncId) throw new Error('ID da Não Conformidade é obrigatório.');

  const user = (await supabase.auth.getUser())?.data?.user;

  const { data, error } = await supabase
    .from('quality_nonconformities')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user?.id || null,
      notes: notes ? `Encerramento: ${notes}` : undefined,
      updated_at: new Date().toISOString()
    })
    .eq('id', ncId)
    .select()
    .single();

  if (error) throw error;

  await auditLog(
    'nonconformity_closed',
    'quality_nonconformities',
    ncId,
    { notes }
  );

  return data;
}

/**
 * Ações 5W2H: Salva ou atualiza uma ação corretiva/preventiva/contenção.
 */
export async function saveQualityAction(action) {
  const isEdit = !!action.id;
  const user = (await supabase.auth.getUser())?.data?.user;

  const payload = {
    nonconformity_id: action.nonconformity_id,
    action_type: action.action_type || 'corrective',
    what: action.what,
    why: action.why || '',
    where_location: action.where_location || '',
    when_deadline: action.when_deadline || null,
    who_owner_id: action.who_owner_id || null,
    who_owner_name: action.who_owner_name || '',
    how: action.how || '',
    how_much: Number(action.how_much) || 0,
    status: action.status || 'pending',
    result_notes: action.result_notes || '',
    updated_at: new Date().toISOString()
  };

  if (!isEdit) {
    payload.created_by = user?.id || null;
  }

  let result;
  if (isEdit) {
    const { data, error } = await supabase
      .from('quality_actions')
      .update(payload)
      .eq('id', action.id)
      .select()
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await supabase
      .from('quality_actions')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    result = data;
  }

  return result;
}

const OPEN_NC_STATUSES = new Set(['open', 'contained', 'analysis', 'action_plan', 'verification']);
const TERMINAL_QUALITY_STATUSES = new Set(['approved', 'rejected']);

function toPositiveQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function qualityEventDate(row) {
  return row?.detected_at || row?.created_at || null;
}

/**
 * Consolida os dados de Qualidade sem misturar leituras bloqueadas/duplicadas
 * com as aprovações e reprovações produtivas.
 */
export function calculateQualityDashboardMetrics({
  nonconformities = [],
  readings = [],
  defectCatalog = [],
} = {}) {
  const defectById = new Map(defectCatalog.map((defect) => [defect.id, defect]));
  const ncList = nonconformities.map((nc) => {
    const catalogDefect = defectById.get(nc.defect_id);
    return {
      ...nc,
      detected_at: qualityEventDate(nc),
      defect_name: nc.defect_name || catalogDefect?.name || 'Outros',
      six_m_category: catalogDefect?.six_m_category || nc.six_m_category || 'Método',
      quantity: toPositiveQuantity(nc.quantity),
    };
  });

  const terminalReadings = readings
    .filter((reading) => TERMINAL_QUALITY_STATUSES.has(reading.status))
    .map((reading) => ({ ...reading, quantity: toPositiveQuantity(reading.quantity) }));

  const totalNCs = ncList.length;
  const totalDefects = ncList.reduce((sum, nc) => sum + nc.quantity, 0);
  const openNCs = ncList.filter((nc) => OPEN_NC_STATUSES.has(nc.status)).length;
  const closedNCs = ncList.filter(nc => nc.status === 'closed').length;
  const criticalNCs = ncList.filter((nc) =>
    OPEN_NC_STATUSES.has(nc.status) && ['high', 'critical'].includes(nc.severity)
  ).length;
  const closureRate = totalNCs > 0 ? (closedNCs / totalNCs) * 100 : 100;

  // 1. ANÁLISE DE PARETO DE DEFEITOS (com percentual acumulado)
  const defectCounts = {};
  ncList.forEach(nc => {
    defectCounts[nc.defect_name] = (defectCounts[nc.defect_name] || 0) + nc.quantity;
  });

  const sortedDefects = Object.entries(defectCounts)
    .map(([defect, count]) => ({ defect, count }))
    .sort((a, b) => b.count - a.count);

  const totalDefectCount = sortedDefects.reduce((sum, item) => sum + item.count, 0);

  let cumulative = 0;
  const paretoData = sortedDefects.map(item => {
    cumulative += item.count;
    const percentage = totalDefectCount > 0 ? (item.count / totalDefectCount) * 100 : 0;
    const cumulativePercentage = totalDefectCount > 0 ? (cumulative / totalDefectCount) * 100 : 0;
    return {
      defect: item.defect,
      count: item.count,
      percentage: Number(percentage.toFixed(1)),
      cumulativePercentage: Number(cumulativePercentage.toFixed(1))
    };
  });

  // 2. FPY: considera apenas a primeira leitura terminal de cada peça/etapa.
  const orderedReadings = [...terminalReadings].sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  );
  const firstPassReadings = [];
  const seenPieceStages = new Set();

  orderedReadings.forEach((reading, index) => {
    const traceableKey = reading.piece_id
      ? `${reading.piece_id}:${reading.step_name || reading.cell_name || 'etapa'}`
      : `volume:${reading.id || index}`;
    if (seenPieceStages.has(traceableKey)) return;
    seenPieceStages.add(traceableKey);
    firstPassReadings.push(reading);
  });

  const firstPassTotal = firstPassReadings.reduce((sum, reading) => sum + reading.quantity, 0);
  const firstPassApproved = firstPassReadings
    .filter((reading) => reading.status === 'approved')
    .reduce((sum, reading) => sum + reading.quantity, 0);
  const approvedReadings = terminalReadings
    .filter((reading) => reading.status === 'approved')
    .reduce((sum, reading) => sum + reading.quantity, 0);
  const rejectedReadings = terminalReadings
    .filter((reading) => reading.status === 'rejected')
    .reduce((sum, reading) => sum + reading.quantity, 0);
  const totalReadings = approvedReadings + rejectedReadings;

  const fpy = firstPassTotal > 0 ? (firstPassApproved / firstPassTotal) * 100 : 100;
  const rejectionRate = totalReadings > 0 ? (rejectedReadings / totalReadings) * 100 : 0;

  // 3. DEFEITOS POR CATEGORIA 6M
  const sixMCounts = Object.fromEntries(SIX_M_CATEGORIES.map((category) => [category, 0]));
  ncList.forEach(nc => {
    const category = SIX_M_CATEGORIES.includes(nc.six_m_category) ? nc.six_m_category : 'Método';
    sixMCounts[category] += nc.quantity;
  });

  const sixMData = Object.entries(sixMCounts)
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0);

  // 4. CONTROLE ESTATÍSTICO com amostra diária real.
  const dailyMap = {};
  terminalReadings.forEach((reading) => {
    const day = reading.created_at ? reading.created_at.substring(0, 10) : null;
    if (!day) return;
    if (!dailyMap[day]) {
      dailyMap[day] = { day, approved: 0, rejected: 0, defects: 0, nonconformities: 0 };
    }
    dailyMap[day][reading.status] += reading.quantity;
  });

  ncList.forEach(nc => {
    const day = nc.detected_at ? nc.detected_at.substring(0, 10) : null;
    if (!day) return;
    if (!dailyMap[day]) {
      dailyMap[day] = { day, approved: 0, rejected: 0, defects: 0, nonconformities: 0 };
    }
    dailyMap[day].defects += nc.quantity;
    dailyMap[day].nonconformities += 1;
  });

  const pBar = totalReadings > 0 ? rejectedReadings / totalReadings : 0;
  const pChartData = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day)).map(d => {
    const sampleSize = d.approved + d.rejected;
    const p = sampleSize > 0 ? d.rejected / sampleSize : 0;
    const u = sampleSize > 0 ? d.defects / sampleSize : 0;
    const sigma = sampleSize > 0 ? Math.sqrt((pBar * (1 - pBar)) / sampleSize) : 0;
    const uclP = Math.min(1, pBar + 3 * sigma);
    const lclP = Math.max(0, pBar - 3 * sigma);

    return {
      date: d.day,
      approved: d.approved,
      rejected: d.rejected,
      nonconformities: d.nonconformities,
      sampleSize,
      rejectionRate: Number((p * 100).toFixed(1)),
      p: Number(p.toFixed(3)),
      u: Number(u.toFixed(3)),
      pBar: Number(pBar.toFixed(3)),
      ucl: Number(uclP.toFixed(3)),
      lcl: Number(lclP.toFixed(3))
    };
  });

  const cellCounts = {};
  ncList.forEach((nc) => {
    const cell = nc.cell_name || nc.stage_name || 'Não informada';
    cellCounts[cell] = (cellCounts[cell] || 0) + nc.quantity;
  });
  const byCellData = Object.entries(cellCounts)
    .map(([cell, defects]) => ({ cell, defects }))
    .sort((a, b) => b.defects - a.defects);

  return {
    totalNCs,
    totalDefects,
    openNCs,
    closedNCs,
    criticalNCs,
    closureRate: Number(closureRate.toFixed(1)),
    fpy: Number(fpy.toFixed(1)),
    rejectionRate: Number(rejectionRate.toFixed(1)),
    approvedReadings,
    rejectedReadings,
    topDefect: paretoData[0]?.defect || 'Sem ocorrências',
    paretoData,
    sixMData,
    pChartData,
    byCellData,
  };
}

/**
 * Dashboard & Estatísticas de Qualidade: Retorna KPIs, Pareto, FPY e Cartas SPC.
 */
export async function getQualityDashboardMetrics({ cellId = null, dateFrom = null, dateTo = null } = {}) {
  let ncQuery = supabase.from('quality_nonconformities').select('*');
  let readingsQuery = supabase
    .from('production_stage_readings')
    .select('id, piece_id, step_name, cell_name, status, quantity, created_at')
    .in('status', ['approved', 'rejected']);

  if (cellId) ncQuery = ncQuery.eq('cell_id', cellId);
  if (dateFrom) {
    ncQuery = ncQuery.gte('created_at', dateFrom);
    readingsQuery = readingsQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    ncQuery = ncQuery.lte('created_at', dateTo);
    readingsQuery = readingsQuery.lte('created_at', dateTo);
  }

  const [ncResult, readingsResult, defectsResult] = await Promise.all([
    ncQuery,
    readingsQuery,
    supabase
      .from('quality_defect_catalog')
      .select('id, name, six_m_category'),
  ]);

  if (ncResult.error) throw ncResult.error;
  if (readingsResult.error) throw readingsResult.error;
  if (defectsResult.error) throw defectsResult.error;

  return calculateQualityDashboardMetrics({
    nonconformities: ncResult.data || [],
    readings: readingsResult.data || [],
    defectCatalog: defectsResult.data || [],
  });
}

/**
 * Exporta lista de Não Conformidades para arquivo CSV.
 */
export function exportNonconformitiesCSV(nonconformities = []) {
  if (!nonconformities.length) return;

  const headers = ['Código NC', 'Defeito', 'Quantidade', 'Severidade', 'Disposição', 'Status', 'Lote', 'Pedido', 'Cliente', 'Célula', 'Data Detecção', 'Observações'];
  const rows = nonconformities.map(nc => [
    nc.nc_code || '',
    nc.defect_name || '',
    nc.quantity || 1,
    nc.severity || '',
    NC_DISPOSITION_LABELS[nc.disposition]?.label || nc.disposition || '',
    NC_STATUS_LABELS[nc.status]?.label || nc.status || '',
    nc.lot_code || '',
    nc.order_number || '',
    nc.customer_name || '',
    nc.cell_name || '',
    nc.detected_at ? new Date(nc.detected_at).toLocaleString('pt-BR') : '',
    `"${(nc.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF'
    + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `relatorio_qualidade_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

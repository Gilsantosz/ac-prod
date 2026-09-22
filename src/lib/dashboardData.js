import { supabase } from '@/lib/supabaseClient';
import { getDashboardPeriodRange } from '@/lib/dashboardPeriod';

const PAGE_SIZE = 1000;

// O dashboard usa somente este recorte de production_entries. Evitar select('*')
// reduz o tráfego sem alterar os cálculos, filtros ou relatórios existentes.
export const DASHBOARD_PRODUCTION_SELECT = [
  'id',
  'lot_id',
  'date',
  'shift',
  'cell',
  'hour',
  'produced',
  'target',
  'scrap',
  'downtime',
  'operator',
  'notes',
  'created_at',
  'process_step',
  'entry_mode',
  'source',
  'approval_status',
  'client_event_id',
  'operation_name',
  'route_name',
  'metric_unit',
  'metric_unit_label',
  'metric_name',
  'planned_capacity',
  'planned_target',
  'realized_quantity',
  'sheet_count',
  'edge_meters',
  'pieces_quantity',
  'covers_quantity',
].join(',');

export async function fetchDashboardProductionEntries(referenceDate, year) {
  const { startDate, endDate } = getDashboardPeriodRange(referenceDate, year);
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('production_entries')
      .select(DASHBOARD_PRODUCTION_SELECT)
      .gte('date', startDate)
      .lt('date', endDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows.map((row) => ({ ...row, created_date: row.created_at }));
}

export async function fetchDashboardYearBounds() {
  const [oldestResult, newestResult] = await Promise.all([
    supabase
      .from('production_entries')
      .select('date')
      .not('date', 'is', null)
      .order('date', { ascending: true })
      .limit(1),
    supabase
      .from('production_entries')
      .select('date')
      .not('date', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
  ]);

  if (oldestResult.error) throw oldestResult.error;
  if (newestResult.error) throw newestResult.error;

  return {
    oldestDate: oldestResult.data?.[0]?.date,
    newestDate: newestResult.data?.[0]?.date,
  };
}

// Goal history is effective-dated. A lower date bound would discard the last
// valid goal inherited from previous months. Never fall back to legacy daily_goals.
export async function fetchDashboardDailyGoals(referenceDate, year) {
  const { endDate } = getDashboardPeriodRange(referenceDate, year);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('production_daily_goals')
      .select('id,date,shift,cell_name,metric_unit,target,capacity,updated_at')
      .lt('date', endDate)
      .order('date', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []).map((goal) => ({ ...goal, cell: goal.cell_name })));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

export async function fetchDashboardGoalContext(referenceDate, year) {
  const { startDate, endDate } = getDashboardPeriodRange(referenceDate, year);
  const loadCalendar = async () => {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from('workday_calendar')
        .select('id,date,cell,shift,is_workday,updated_at')
        .gte('date', startDate).lt('date', endDate)
        .order('date', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < PAGE_SIZE) return rows;
    }
  };
  const [goals, calendar] = await Promise.all([fetchDashboardDailyGoals(referenceDate, year), loadCalendar()]);
  return { goals, calendar };
}

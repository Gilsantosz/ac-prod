import { supabase } from '@/lib/supabaseClient';
import { normalizeProductionName } from '@/lib/productionStagePolicyService';

const PAGE_SIZE = 1000;

async function fetchPaged(buildQuery) {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export function fetchProductionEntriesRange(fromDate, toDate = fromDate) {
  return fetchPaged(() => {
    let query = supabase
      .from('production_entries')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('created_at', { ascending: false });

    return query;
  });
}

export async function fetchProductionGoalsRange(fromDate, toDate = fromDate) {
  try {
    const [rangeGoals, priorResult] = await Promise.all([
      fetchPaged(() => supabase
        .from('production_daily_goals')
        .select('*')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date', { ascending: true })),
      supabase
        .from('production_daily_goals')
        .select('*')
        .lt('date', fromDate)
        .order('date', { ascending: false })
        .limit(1000),
    ]);

    if (priorResult.error) throw priorResult.error;

    const dates = [];
    const cursor = new Date(`${fromDate}T12:00:00`);
    const end = new Date(`${toDate}T12:00:00`);
    while (cursor <= end && dates.length < 3700) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    const keyForGoal = (goal) => [
      normalizeProductionName(goal.cell_name || goal.cell),
      String(goal.shift || '').trim(),
      String(goal.metric_unit || goal.unit || 'pieces').trim().toLowerCase(),
    ].join('||');
    const latest = new Map();

    [...(priorResult.data || [])]
      .reverse()
      .forEach((goal) => latest.set(keyForGoal(goal), goal));

    const exactByDate = new Map();
    rangeGoals.forEach((goal) => {
      const list = exactByDate.get(goal.date) || [];
      list.push(goal);
      exactByDate.set(goal.date, list);
    });

    return dates.flatMap((date) => {
      (exactByDate.get(date) || []).forEach((goal) => latest.set(keyForGoal(goal), goal));
      return [...latest.values()].map((goal) => ({
        ...goal,
        date,
        inherited_from_date: goal.date === date ? null : goal.date,
      }));
    });
  } catch (error) {
    if (/schema cache|does not exist|production_daily_goals/i.test(error?.message || '')) return [];
    throw error;
  }
}

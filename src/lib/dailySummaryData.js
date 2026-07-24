import { supabase } from '@/lib/supabaseClient';

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
    return await fetchPaged(() => supabase
      .from('production_daily_goals')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date', { ascending: true }));
  } catch (error) {
    if (/schema cache|does not exist|production_daily_goals/i.test(error?.message || '')) return [];
    throw error;
  }
}


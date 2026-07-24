import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

function getSaoPauloDateString(offsetDays = 0) {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

export async function fetchReportDataForType(supabase: any, type: string, schedule: any) {
  const today = getSaoPauloDateString(0);
  const yesterday = getSaoPauloDateString(-1);
  const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(String(schedule.report_date || ''))
    ? String(schedule.report_date)
    : null;
  const targetDate = explicitDate
    || (schedule.period_mode === 'previous_day' ? yesterday : today);

  const applyProductionFilters = (query: any, cellColumn: string) => {
    if (schedule.cell_filter && schedule.cell_filter.length > 0) {
      query = query.in(cellColumn, schedule.cell_filter);
    }
    if (schedule.shift_filter && schedule.shift_filter.length > 0) {
      query = query.in('shift', schedule.shift_filter);
    }
    return query;
  };

  const fetchProductionBundle = async (fromDate: string, toDate: string) => {
    let entriesQuery = supabase
      .from('production_entries')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate);
    entriesQuery = applyProductionFilters(entriesQuery, 'cell');

    let goalsQuery = supabase
      .from('production_daily_goals')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate);
    goalsQuery = applyProductionFilters(goalsQuery, 'cell_name');

    const [entriesResult, goalsResult] = await Promise.all([entriesQuery, goalsQuery]);
    if (entriesResult.error) throw entriesResult.error;
    if (goalsResult.error) throw goalsResult.error;
    return {
      entries: entriesResult.data || [],
      goals: goalsResult.data || [],
      fromDate,
      toDate,
    };
  };

  if (type === 'daily_production' || type === 'shift_closure') {
    return fetchProductionBundle(targetDate, targetDate);
  }

  if (type === 'oee') {
    // Fechamento manual usa exatamente a data escolhida. Relatórios OEE
    // recorrentes sem data explícita continuam cobrindo os últimos 7 dias.
    const fromDate = explicitDate ? targetDate : getSaoPauloDateString(-6);
    return fetchProductionBundle(fromDate, targetDate);
  }


  if (type === 'traceability_pending') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .neq('status', 'finished')
      .order('created_at', { ascending: false });
    return data || [];
  }

  if (type === 'lots_delayed') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .neq('status', 'finished')
      .lt('delivery_date', new Date().toISOString());
    return data || [];
  }

  if (type === 'packaging_pending') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .eq('status', 'packaging')
      .order('created_at', { ascending: false });
    return data || [];
  }

  if (type === 'shipping_pending') {
    const { data } = await supabase
      .from('packages')
      .select('*, shipments(*)')
      .neq('status', 'shipped')
      .order('created_at', { ascending: false });
    return data || [];
  }

  if (type === 'executive_summary') {
    const { data: delayedLots } = await supabase
      .from('production_lots')
      .select('id')
      .neq('status', 'finished')
      .lt('delivery_date', new Date().toISOString());

    const { data: activeOccurrences } = await supabase
      .from('occurrences')
      .select('*')
      .eq('status', 'open');

    return {
      delayedCount: delayedLots?.length || 0,
      activeOccurrences: activeOccurrences || []
    };
  }

  return [];
}

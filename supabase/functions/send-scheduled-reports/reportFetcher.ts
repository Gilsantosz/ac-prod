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
  const targetDate = schedule.frequency === 'daily' || schedule.frequency === 'workdays' ? yesterday : today;

  if (type === 'daily_production' || type === 'shift_closure') {
    let q = supabase.from('production_entries').select('*').eq('date', targetDate);
    if (schedule.cell_filter && schedule.cell_filter.length > 0) {
      q = q.in('cell', schedule.cell_filter);
    }
    const { data } = await q;
    return data || [];
  }

  if (type === 'oee') {
    const dateLimit = getSaoPauloDateString(-7);
    let q = supabase.from('production_entries').select('*').gte('date', dateLimit);
    if (schedule.cell_filter && schedule.cell_filter.length > 0) {
      q = q.in('cell', schedule.cell_filter);
    }
    const { data: entries } = await q;
    return entries || [];
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

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
  const filters = schedule.filter_snapshot && typeof schedule.filter_snapshot === 'object'
    ? schedule.filter_snapshot
    : {};
  const validDate = (value: unknown) => (
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null
  );
  const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(String(schedule.report_date || ''))
    ? String(schedule.report_date)
    : null;
  const explicitStart = validDate(schedule.report_start_date) || validDate(filters.startDate) || explicitDate;
  const explicitEnd = validDate(schedule.report_end_date) || validDate(filters.endDate) || explicitStart;
  const targetDate = explicitDate
    || (schedule.period_mode === 'previous_day' ? yesterday : today);

  const toList = (value: unknown) => (
    Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
  );
  const normalizedCells = toList(filters.cells).length
    ? toList(filters.cells)
    : toList(schedule.cell_filter);
  const normalizedShifts = toList(filters.shifts).length
    ? toList(filters.shifts)
    : toList(schedule.shift_filter);
  const requestedLots = [...new Set([
    ...toList(filters.lots),
    String(filters.lotCode || '').trim(),
    String(filters.clientLotCode || '').trim(),
  ].filter(Boolean))];
  const includesText = (value: unknown, term: unknown) => (
    !String(term || '').trim()
    || String(value || '').toLocaleLowerCase('pt-BR').includes(String(term).trim().toLocaleLowerCase('pt-BR'))
  );
  const matchesEntry = (entry: any) => {
    if (requestedLots.length && !requestedLots.some((lot) => includesText(entry.lot_code, lot))) return false;
    if (filters.generalLotCode && !includesText(
      `${entry.general_lot_code || ''} ${entry.load_number || ''}`,
      filters.generalLotCode,
    )) return false;
    if (!includesText(entry.operator, filters.operator)) return false;
    if (!includesText(entry.order_number, filters.order)) return false;
    if (!includesText(entry.load_number, filters.loadNumber)) return false;
    if (!includesText(`${entry.product_code || ''} ${entry.product_name || ''}`, filters.product)) return false;
    if (!includesText(
      `${entry.customer_name || ''} ${entry.customer_trade_name || ''} ${entry.customer_legal_name || ''}`,
      filters.client,
    )) return false;
    if (!includesText(entry.customer_legal_name, filters.customerLegalName)) return false;
    if (!includesText(`${entry.route_code || ''} ${entry.route_name || ''}`, filters.route)) return false;
    if (filters.finalizationDate && entry.finalization_date !== filters.finalizationDate) return false;
    if (!includesText(entry.pallet_number, filters.palletNumber)) return false;
    if (!includesText(entry.process_step || entry.step_code, filters.stage)) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.approvalStatus && entry.approval_status !== filters.approvalStatus) return false;
    if (filters.onlyWithScrap && Number(entry.scrap || 0) <= 0) return false;
    if (filters.onlyWithDowntime && Number(entry.downtime || 0) <= 0) return false;
    return true;
  };
  const hasEntityScope = requestedLots.length > 0 || [
    'generalLotCode',
    'operator',
    'order',
    'loadNumber',
    'product',
    'client',
    'customerLegalName',
    'route',
    'finalizationDate',
    'palletNumber',
    'stage',
    'status',
    'approvalStatus',
  ].some((field) => String(filters[field] || '').trim())
    || filters.onlyWithScrap === true
    || filters.onlyWithDowntime === true
    || filters.onlyWithOccurrence === true;

  const applyProductionFilters = (query: any, cellColumn: string) => {
    if (normalizedCells.length > 0) {
      query = query.in(cellColumn, normalizedCells);
    }
    if (normalizedShifts.length > 0) {
      query = query.in('shift', normalizedShifts);
    }
    return query;
  };

  const applyDateRange = (query: any, fromDate: string | null, toDate: string | null) => {
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    return query;
  };

  const fetchProductionBundle = async (fromDate: string | null, toDate: string | null) => {
    let entriesQuery = supabase
      .from('production_entries')
      .select('*');
    entriesQuery = applyDateRange(entriesQuery, fromDate, toDate);
    entriesQuery = applyProductionFilters(entriesQuery, 'cell');

    let goalsQuery = supabase
      .from('production_daily_goals')
      .select('*');
    goalsQuery = applyDateRange(goalsQuery, fromDate, toDate);
    goalsQuery = applyProductionFilters(goalsQuery, 'cell_name');

    let occurrencesQuery = null;
    if (filters.onlyWithOccurrence === true) {
      occurrencesQuery = supabase.from('occurrences').select('date,shift,cell,lot_code');
      occurrencesQuery = applyDateRange(occurrencesQuery, fromDate, toDate);
      occurrencesQuery = applyProductionFilters(occurrencesQuery, 'cell');
    }

    const [entriesResult, goalsResult, occurrencesResult] = await Promise.all([
      entriesQuery,
      goalsQuery,
      occurrencesQuery || Promise.resolve({ data: [], error: null }),
    ]);
    if (entriesResult.error) throw entriesResult.error;
    if (goalsResult.error) throw goalsResult.error;
    if (occurrencesResult.error) throw occurrencesResult.error;
    const occurrenceKeys = new Set((occurrencesResult.data || [])
      .filter((item: any) => (
        !requestedLots.length || requestedLots.some((lot) => includesText(item.lot_code, lot))
      ))
      .map((item: any) => `${item.date}|${item.shift}|${item.cell}`));
    const entries = (entriesResult.data || []).filter((entry: any) => (
      matchesEntry(entry)
      && (
        filters.onlyWithOccurrence !== true
        || occurrenceKeys.has(`${entry.date}|${entry.shift}|${entry.cell}`)
      )
    ));
    return {
      entries,
      // Metas de toda a célula não são comparáveis a um recorte por lote,
      // cliente, produto ou operador; nesse caso, não exibimos uma meta enganosa.
      goals: hasEntityScope ? [] : (goalsResult.data || []),
      fromDate,
      toDate,
    };
  };

  if (type === 'daily_production' || type === 'shift_closure') {
    if (filters.allHistory === true && !explicitStart && !explicitEnd) {
      return fetchProductionBundle(null, null);
    }
    return fetchProductionBundle(explicitStart || targetDate, explicitEnd || explicitStart || targetDate);
  }

  if (type === 'oee') {
    if (filters.allHistory === true && !explicitStart && !explicitEnd) {
      return fetchProductionBundle(null, null);
    }
    // Fechamentos manuais preservam o intervalo solicitado. Relatórios OEE
    // recorrentes sem intervalo explícito continuam cobrindo os últimos 7 dias.
    const fromDate = explicitStart || (explicitDate ? targetDate : getSaoPauloDateString(-6));
    const toDate = explicitEnd || targetDate;
    return fetchProductionBundle(fromDate, toDate);
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

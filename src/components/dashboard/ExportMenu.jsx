import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { isAnnualFilterActive } from '@/lib/dashboardPeriod';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { filterProductionUnit } from '@/lib/productionSelection';
import ExportReportMenu from '@/components/reports/ExportReportMenu';

function describePeriod({ from, to }) {
  const display = (date) => format(new Date(`${date}T12:00:00`), 'dd/MM/yyyy');
  return from === to ? display(to) : `${display(from)} a ${display(to)}`;
}

export default function ExportMenu({ entries, allEntries, filters }) {
  const { user } = useAuth();
  const annualMode = isAnnualFilterActive(filters.year);
  const period = useMemo(() => ({
    from: annualMode ? `${filters.year}-01-01` : filters.date,
    to: annualMode ? `${filters.year}-12-31` : filters.date,
  }), [annualMode, filters.date, filters.year]);
  const weeklyPeriod = useMemo(() => annualMode ? null : ({
    from: format(subDays(new Date(`${filters.date}T12:00:00`), 6), 'yyyy-MM-dd'),
    to: filters.date,
  }), [annualMode, filters.date]);
  const weeklyEntries = useMemo(() => !weeklyPeriod ? [] : filterProductionUnit(
    allEntries.filter((entry) => entry.date >= weeklyPeriod.from && entry.date <= weeklyPeriod.to
      && (filters.cell === 'all' || entry.cell === filters.cell)
      && (filters.shift === 'all' || entry.shift === filters.shift)),
    filters.metric_unit,
  ), [allEntries, weeklyPeriod, filters.cell, filters.shift, filters.metric_unit]);

  const buildReport = (source, selectedPeriod) => createProductionAnalysisReport({
    generatedAt: new Date().toISOString(), period: selectedPeriod,
    comparisonPeriod: null, entries: filterProductionUnit(source, filters.metric_unit),
    filters, fetchedRowCount: source.length,
  }, { generatedBy: user?.name || user?.email || '' });
  const report = useMemo(() => buildReport(entries, period), [entries, period, filters, user?.name, user?.email]);

  const reportGroups = [{
    id: 'selected-period',
    label: annualMode ? `Ano de ${filters.year}` : 'Período selecionado',
    description: describePeriod(period),
    report,
    disabled: !report.metadata.rowCount,
  }];
  if (weeklyPeriod) {
    reportGroups.push({
      id: 'last-seven-days',
      label: 'Últimos 7 dias',
      description: describePeriod(weeklyPeriod),
      getReport: () => buildReport(weeklyEntries, weeklyPeriod),
      disabled: !weeklyEntries.length,
    });
  }

  return <ExportReportMenu reportGroups={reportGroups} />;
}

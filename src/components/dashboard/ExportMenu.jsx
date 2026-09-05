import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { isAnnualFilterActive } from '@/lib/dashboardPeriod';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import ExportReportMenu from '@/components/reports/ExportReportMenu';

export default function ExportMenu({ entries, allEntries, filters }) {
  const { user } = useAuth();
  const annualMode = isAnnualFilterActive(filters.year);
  const build = (weekly = false) => {
    const to = annualMode ? `${filters.year}-12-31` : filters.date;
    const from = annualMode ? `${filters.year}-01-01` : weekly ? format(subDays(new Date(`${to}T12:00:00`), 6), 'yyyy-MM-dd') : to;
    const source = weekly ? allEntries.filter((e) => e.date >= from && e.date <= to
      && (filters.cell === 'all' || e.cell === filters.cell) && (filters.shift === 'all' || e.shift === filters.shift)) : entries;
    return createProductionAnalysisReport({ generatedAt: new Date().toISOString(), period: { from, to },
      comparisonPeriod: null, entries: source, filters, fetchedRowCount: source.length }, { generatedBy: user?.name || user?.email || '' });
  };
  const report = useMemo(() => build(), [entries, filters, user?.name, user?.email]);
  return <div className="flex flex-wrap gap-2"><ExportReportMenu report={report} disabled={!report.metadata.rowCount} />
    {!annualMode && <span className="flex items-center gap-2 text-xs text-muted-foreground"><span>Semana:</span><ExportReportMenu getReport={() => build(true)} disabled={!allEntries.length} /></span>}
  </div>;
}

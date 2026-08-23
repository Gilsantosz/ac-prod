import { useMemo } from 'react';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { createDailySummaryReport, exportDailySummaryPdf } from '@/lib/exportDailySummary';

export default function ExportDailyButton({ date, shift, cell, summary, cells = [], generatedBy = '', disabled = false }) {
  const payload = useMemo(() => ({ date, shift, cell, summary, cells, generatedBy }), [cell, cells, date, generatedBy, shift, summary]);
  const report = useMemo(() => createDailySummaryReport(payload), [payload]);
  const formatExporters = useMemo(() => ({ pdf: () => exportDailySummaryPdf(payload) }), [payload]);

  return <ExportReportMenu report={report} formats={['pdf', 'xlsx']} disabled={disabled} formatExporters={formatExporters} />;
}

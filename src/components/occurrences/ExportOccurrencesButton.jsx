import { useMemo } from 'react';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { exportOccurrencesPdf } from '@/lib/exportOccurrences';
import { createOccurrenceReportDefinition } from '@/lib/reports/occurrenceReportDefinition';
import { buildReportFilename } from '@/lib/reports/reportDataUtils';

export default function ExportOccurrencesButton({ occurrences, date, cell, shift, chartEl, generatedBy = '' }) {
  const report = useMemo(
    () => createOccurrenceReportDefinition({ occurrences, date, cell, shift, generatedBy }),
    [cell, date, generatedBy, occurrences, shift],
  );
  const formatExporters = useMemo(() => ({
    pdf: (definition) => exportOccurrencesPdf(
      occurrences,
      date,
      cell,
      shift,
      chartEl,
      buildReportFilename(definition, 'pdf'),
    ),
  }), [cell, chartEl, date, occurrences, shift]);

  return <ExportReportMenu report={report} disabled={!report.tables[0].rows.length} formatExporters={formatExporters} />;
}

import { useMemo } from 'react';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { exportOeeReport } from '@/lib/exportOeeReport';
import { createOeeReportDefinition } from '@/lib/reports/oeeReportDefinition';
import { buildReportFilename } from '@/lib/reports/reportDataUtils';

export default function OeeReportButton({ overall, byCell, occurrences, meta, filters, chartsRef, generatedBy = '', disabled }) {
  const report = useMemo(() => createOeeReportDefinition({ overall, byCell, occurrences, filters, generatedBy }), [byCell, filters, generatedBy, occurrences, overall]);
  const formatExporters = useMemo(() => ({
    pdf: (definition) => exportOeeReport(
      { overall, byCell, occurrences, meta, chartsEl: chartsRef?.current },
      buildReportFilename(definition, 'pdf'),
    ),
  }), [byCell, chartsRef, meta, occurrences, overall]);

  return <ExportReportMenu report={report} disabled={disabled || !overall || !byCell.length} formatExporters={formatExporters} />;
}

import { describe, expect, it } from 'vitest';
import { createIntegrityAuditReportDefinition, createSystemAuditReportDefinition } from '@/lib/reports/auditReportDefinitions';
import { createOccurrenceReportDefinition } from '@/lib/reports/occurrenceReportDefinition';
import { createOeeReportDefinition } from '@/lib/reports/oeeReportDefinition';
import { createReplacementReportDefinition } from '@/lib/reports/replacementReportDefinition';
import { createTraceabilityReportDefinition } from '@/lib/reports/traceabilityReportDefinition';
import { validateReportDefinition } from '@/lib/reports/reportDefinition';

describe('definições compartilhadas dos relatórios migrados', () => {
  it('produz contratos válidos com uma tabela primária para todos os dados exportáveis', () => {
    const definitions = [
      createOeeReportDefinition({
        overall: { oee: 80, availability: 90, performance: 95, quality: 94, downtimeMin: 20 },
        byCell: [{ cell: 'Corte', oee: 80, availability: 90, performance: 95, quality: 94 }],
        filters: { date: '2026-08-23', shift: 'all', cell: 'all' },
      }),
      createOccurrenceReportDefinition({
        date: '2026-08-23',
        occurrences: [{ date: '2026-08-23', shift: '1', cell: 'Corte', reason: 'Setup', downtime: 12 }],
      }),
      createTraceabilityReportDefinition({
        rows: [{ date: '2026-08-23', hour: '08:00', tag: '=DANGER', status: 'approved' }],
        filters: { date: '2026-08-23', tagType: 'all', cell: 'all', step: 'all', status: 'all', shift: 'all', readerType: 'all' },
      }),
      createSystemAuditReportDefinition({
        rows: [{ id: 'a1', action: 'login', success: true, created_at: '2026-08-23T10:00:00.000Z' }],
        snapshotAt: '2026-08-23T12:00:00.000Z',
        filters: { success: '' },
      }),
      createIntegrityAuditReportDefinition({
        rows: [{ id: 'i1', result_status: 'approved', created_at: '2026-08-23T10:00:00.000Z' }],
        snapshotAt: '2026-08-23T12:00:00.000Z',
        filters: { dateFrom: '2026-08-23', dateTo: '2026-08-23', status: 'all' },
      }),
      createReplacementReportDefinition({
        rows: [{ id: 'r1', replacement_code: 'REP-1', status: 'requested', priority: 'critical', created_at: '2026-08-23T10:00:00.000Z' }],
        snapshotAt: '2026-08-23T12:00:00.000Z',
        filters: { tab: 'active', status: 'all', priority: 'all' },
      }),
    ];

    definitions.forEach((definition) => {
      expect(validateReportDefinition(definition)).toBe(true);
      expect(definition.tables.some((table) => table.primary && table.rows.length === 1)).toBe(true);
    });
  });
});

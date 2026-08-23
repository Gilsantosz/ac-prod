// Exportação de dados de produção para CSV
import { buildBrandedCsv, downloadBlob } from '@/lib/reportBranding';
import { buildReportFilename } from '@/lib/reports/reportDataUtils';

const HEADERS = [
  { key: 'date', label: 'Data' },
  { key: 'shift', label: 'Turno' },
  { key: 'cell', label: 'Célula' },
  { key: 'hour', label: 'Hora' },
  { key: 'produced', label: 'Produzido' },
  { key: 'target', label: 'Meta' },
  { key: 'scrap', label: 'Refugos' },
  { key: 'downtime', label: 'Parada (min)' },
  { key: 'operator', label: 'Operador' },
  { key: 'notes', label: 'Observações' },
];

export function exportProductionCsv(entries, meta = {}) {
  const produced = entries.reduce((sum, e) => sum + (Number(e.produced) || 0), 0);
  const target = entries.reduce((sum, e) => sum + (Number(e.target) || 0), 0);
  const scrap = entries.reduce((sum, e) => sum + (Number(e.scrap) || 0), 0);
  const downtime = entries.reduce((sum, e) => sum + (Number(e.downtime) || 0), 0);
  const csv = buildBrandedCsv({
    title: meta.title || 'Relatorio Analitico de Producao',
    subtitle: meta.subtitle || 'Historico filtrado',
    summary: [
      { label: 'Registros', value: entries.length },
      { label: 'Produzido', value: produced },
      { label: 'Meta', value: target },
      { label: 'Refugo', value: scrap },
      { label: 'Paradas (min)', value: downtime },
    ],
    columns: HEADERS,
    rows: entries,
  });

  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    buildReportFilename({ id: 'producao', generatedAt: new Date().toISOString(), period: meta.period }, 'csv')
  );
}

// Exportação de dados de produção para CSV
import { format } from 'date-fns';
import { buildBrandedCsv, downloadBlob } from '@/lib/reportBranding';

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
    `relatorio-producao-${format(new Date(), 'yyyy-MM-dd')}.csv`
  );
}

// Exportação de dados de produção para CSV
import { format } from 'date-fns';

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

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportProductionCsv(entries) {
  const header = HEADERS.map((h) => h.label).join(';');
  const rows = entries.map((e) => HEADERS.map((h) => escapeCsv(e[h.key])).join(';'));
  const csv = '\uFEFF' + [header, ...rows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio-producao-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
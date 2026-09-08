// Presentation-only helpers. Never coerce absent measurements to zero.
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 20 });
export function formatChartValue(value) {
  if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  if (typeof value === 'number') return numberFormat.format(value);
  if (Array.isArray(value)) return value.map(formatChartValue).join(' – ');
  return typeof value === 'string' ? value : '—';
}
export function readChartValue(row, key) {
  if (typeof key === 'function') return key(row);
  if (key == null) return undefined;
  return String(key).split('.').reduce((value, part) => (
    value != null && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined
  ), row);
}
export function dataPage(rows, index, size = 20) {
  const pageSize = Math.max(1, Math.floor(size) || 20);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Math.floor(index) || 0));
  return { page, pageCount, rows: rows.slice(page * pageSize, (page + 1) * pageSize) };
}
export function seriesPaint(props, kind) {
  const paint = kind === 'Line' ? props.stroke : props.fill;
  // Preserve bespoke paint servers, quality semantics and caller-defined colors.
  if (typeof paint === 'string' && /^(url\(|none$|transparent$)/.test(paint)) return null;
  const key = String(props.name || props.dataKey || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^(produzido|produced|aprovadas?|aprovados?)$/.test(key)) return ['#34d399', '#15803d'];
  if (/^(meta|target)$/.test(key)) return ['#cbd5e1', '#64748b'];
  if (!paint && /atingimento|eficiencia|attainment/.test(key)) return ['#38bdf8', '#2563eb'];
  return [paint || '#34d399', paint || '#15803d'];
}

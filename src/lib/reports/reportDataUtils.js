import { format, parseISO, startOfMonth, subMonths } from 'date-fns';

export const REPORT_LOCALE = 'pt-BR';
export const REPORT_TIME_ZONE = 'America/Sao_Paulo';
export const REPORT_ROW_LIMITS = Object.freeze({
  pdf: 5_000,
  xlsx: 100_000,
  csv: 100_000,
});

const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;

export function sanitizeSpreadsheetText(value) {
  if (typeof value !== 'string') return value;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function parseIsoDateLocal(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDatePtBr(value) {
  const date = parseIsoDateLocal(value);
  return date ? date.toLocaleDateString(REPORT_LOCALE) : String(value || '');
}

export function formatDateTimePtBr(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString(REPORT_LOCALE, { timeZone: REPORT_TIME_ZONE });
}

export function getDefaultReportPeriod(now = new Date(), monthCount = 12) {
  const from = startOfMonth(subMonths(now, Math.max(1, monthCount) - 1));
  return { from: format(from, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') };
}

export function getColumnValue(row, column) {
  return typeof column.value === 'function' ? column.value(row) : row?.[column.key];
}

function serializeCsvValue(value, column = {}) {
  if (value == null) return '';
  if (column.type === 'date' && value instanceof Date) return format(value, 'yyyy-MM-dd');
  if (column.type === 'datetime' && value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(sanitizeSpreadsheetText(String(value)));
}

export function escapeCsvCell(value, delimiter = ';', column = {}) {
  const text = serializeCsvValue(value, column);
  if (!text.includes(delimiter) && !/["\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildRawCsv({ columns = [], rows = [], delimiter = ';', includeBom = true } = {}) {
  const header = columns.map((column) => escapeCsvCell(column.label, delimiter)).join(delimiter);
  const body = rows.map((row) => columns
    .map((column) => escapeCsvCell(getColumnValue(row, column), delimiter, column))
    .join(delimiter));
  return `${includeBom ? '\uFEFF' : ''}${[header, ...body].join('\r\n')}`;
}

export function slugifyReportPart(value, fallback = 'relatorio') {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || fallback;
}

export function buildReportFilename(report, formatName) {
  const formatKey = String(formatName || '').toLowerCase();
  const kind = formatKey === 'csv' ? 'dados' : 'relatorio';
  const reportId = slugifyReportPart(report?.id || report?.title);
  const from = report?.period?.from;
  const to = report?.period?.to;
  const period = [from, to].filter(Boolean).join('_') || format(new Date(report?.generatedAt || Date.now()), 'yyyy-MM-dd');
  return `leo-flow-${kind}-${reportId}-${slugifyReportPart(period, 'sem-periodo')}.${formatKey}`;
}

export function getReportRowCount(report) {
  return Math.max(0, ...(report?.tables || []).map((table) => table.rows?.length || 0));
}

export function assertReportRowLimit(report, formatName) {
  const formatKey = String(formatName || '').toLowerCase();
  const limit = REPORT_ROW_LIMITS[formatKey];
  const rowCount = getReportRowCount(report);
  if (limit && rowCount > limit) {
    const error = new Error(`O relatório possui ${rowCount.toLocaleString(REPORT_LOCALE)} linhas. O limite seguro para ${formatKey.toUpperCase()} é ${limit.toLocaleString(REPORT_LOCALE)}; reduza o período ou os filtros.`);
    error.code = 'REPORT_ROW_LIMIT_EXCEEDED';
    error.details = { format: formatKey, rowCount, limit };
    throw error;
  }
  return rowCount;
}

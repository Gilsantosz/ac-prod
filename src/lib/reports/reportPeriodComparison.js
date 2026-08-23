import {
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns';

const ISO_DATE = 'yyyy-MM-dd';

function parsePeriodDate(value, field) {
  const date = parseISO(String(value || ''));
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida no campo ${field}.`);
  return date;
}

export function normalizeReportPeriod(period = {}) {
  const from = parsePeriodDate(period.from, 'from');
  const to = parsePeriodDate(period.to, 'to');
  if (from > to) throw new Error('A data inicial do relatório não pode ser posterior à data final.');
  return { from: format(from, ISO_DATE), to: format(to, ISO_DATE) };
}

export function calculateComparisonPeriod(period) {
  const normalized = normalizeReportPeriod(period);
  const from = parseISO(normalized.from);
  const to = parseISO(normalized.to);

  if (isSameDay(from, startOfYear(from)) && isSameDay(to, endOfYear(to)) && from.getFullYear() === to.getFullYear()) {
    return {
      from: format(startOfYear(subYears(from, 1)), ISO_DATE),
      to: format(endOfYear(subYears(to, 1)), ISO_DATE),
      strategy: 'previous-year',
    };
  }

  if (isSameDay(from, startOfMonth(from)) && isSameDay(to, endOfMonth(to))
      && from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    const previousMonth = subMonths(from, 1);
    return {
      from: format(startOfMonth(previousMonth), ISO_DATE),
      to: format(endOfMonth(previousMonth), ISO_DATE),
      strategy: 'previous-month',
    };
  }

  const dayCount = differenceInCalendarDays(to, from) + 1;
  const previousTo = subDays(from, 1);
  return {
    from: format(subDays(previousTo, dayCount - 1), ISO_DATE),
    to: format(previousTo, ISO_DATE),
    strategy: 'previous-equivalent-period',
  };
}

export function calculatePercentageVariation(currentValue, previousValue) {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function calculatePercentagePointDifference(currentValue, previousValue) {
  return (Number(currentValue) || 0) - (Number(previousValue) || 0);
}

export function buildMetricComparison({
  key,
  label,
  current,
  previous,
  mode = 'percent',
  lowerIsBetter = false,
} = {}) {
  const currentNumber = Number(current) || 0;
  const previousNumber = Number(previous) || 0;
  const delta = mode === 'points'
    ? calculatePercentagePointDifference(currentNumber, previousNumber)
    : calculatePercentageVariation(currentNumber, previousNumber);
  const direction = delta == null || delta === 0 ? 'stable' : delta > 0 ? 'up' : 'down';
  const favorable = delta == null || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0;

  return {
    key,
    label,
    current: currentNumber,
    previous: previousNumber,
    mode,
    delta,
    direction,
    lowerIsBetter,
    assessment: favorable == null ? 'neutral' : favorable ? 'positive' : 'negative',
  };
}


import { format } from 'date-fns';
import { efficiency, isValidProductionEntry, scrapRate } from '@/lib/productionMetrics';

export const ANNUAL_FILTER_DISABLED = 'disabled';

const MONTHS = [
  ['Jan', 'Janeiro'],
  ['Fev', 'Fevereiro'],
  ['Mar', 'Março'],
  ['Abr', 'Abril'],
  ['Mai', 'Maio'],
  ['Jun', 'Junho'],
  ['Jul', 'Julho'],
  ['Ago', 'Agosto'],
  ['Set', 'Setembro'],
  ['Out', 'Outubro'],
  ['Nov', 'Novembro'],
  ['Dez', 'Dezembro'],
];

export function isAnnualFilterActive(year) {
  return /^\d{4}$/.test(String(year || ''));
}

export function getDashboardPeriodRange(referenceDate, year) {
  if (isAnnualFilterActive(year)) {
    const selectedYear = Number(year);
    return {
      startDate: `${selectedYear}-01-01`,
      endDate: `${selectedYear + 1}-01-01`,
    };
  }

  const reference = new Date(`${referenceDate}T12:00:00`);
  const safeReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const rangeStart = new Date(safeReference.getFullYear(), safeReference.getMonth(), 1);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(safeReference.getFullYear(), safeReference.getMonth() + 1, 1);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  return {
    startDate: format(rangeStart, 'yyyy-MM-dd'),
    endDate: format(rangeEnd, 'yyyy-MM-dd'),
  };
}

export function matchesDashboardPeriod(date, referenceDate, year) {
  if (!date) return false;
  if (isAnnualFilterActive(year)) return date.startsWith(`${year}-`);
  return !referenceDate || date === referenceDate;
}

export function buildDashboardYearOptions(oldestDate, newestDate, now = new Date()) {
  const currentYear = now.getFullYear();
  const oldestYear = Number(String(oldestDate || '').slice(0, 4));
  const newestYear = Number(String(newestDate || '').slice(0, 4));
  const firstYear = Number.isInteger(oldestYear) && oldestYear > 1900
    ? Math.min(currentYear, oldestYear)
    : currentYear;
  const lastYear = Number.isInteger(newestYear) && newestYear > 1900
    ? Math.max(currentYear, newestYear)
    : currentYear;

  return Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => String(lastYear - index),
  );
}

function monthIndex(date, year) {
  if (typeof date !== 'string' || !date.startsWith(`${year}-`)) return -1;
  const index = Number(date.slice(5, 7)) - 1;
  return index >= 0 && index < 12 ? index : -1;
}

export function buildAnnualProductionSummary(entries = [], year) {
  const months = MONTHS.map(([label, name], index) => ({
    index,
    label,
    name,
    produced: 0,
    target: 0,
    scrap: 0,
    downtime: 0,
    records: 0,
    efficiency: 0,
    scrapRate: 0,
  }));

  (entries || []).filter(isValidProductionEntry).forEach((entry) => {
    const index = monthIndex(entry.date, year);
    if (index < 0) return;
    const month = months[index];
    month.produced += Number(entry.produced) || 0;
    month.target += Number(entry.target) || 0;
    month.scrap += Number(entry.scrap) || 0;
    month.downtime += Number(entry.downtime) || 0;
    month.records += 1;
  });

  months.forEach((month) => {
    month.efficiency = efficiency(month.produced, month.target);
    month.scrapRate = scrapRate(month.scrap, month.produced);
  });

  const totals = months.reduce((result, month) => ({
    produced: result.produced + month.produced,
    target: result.target + month.target,
    scrap: result.scrap + month.scrap,
    downtime: result.downtime + month.downtime,
    records: result.records + month.records,
  }), { produced: 0, target: 0, scrap: 0, downtime: 0, records: 0 });

  return {
    months,
    totals: {
      ...totals,
      efficiency: efficiency(totals.produced, totals.target),
      scrapRate: scrapRate(totals.scrap, totals.produced),
    },
  };
}

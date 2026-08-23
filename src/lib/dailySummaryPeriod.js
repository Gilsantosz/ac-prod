import { ANNUAL_FILTER_DISABLED, isAnnualFilterActive } from '@/lib/dashboardPeriod';

export { ANNUAL_FILTER_DISABLED };

export function getDailySummaryPeriod(date, year = ANNUAL_FILTER_DISABLED) {
  if (isAnnualFilterActive(year)) {
    return {
      fromDate: `${year}-01-01`,
      toDate: `${year}-12-31`,
      annual: true,
      label: `Ano de ${year}`,
    };
  }

  return {
    fromDate: date,
    toDate: date,
    annual: false,
    label: `Data: ${String(date || '').split('-').reverse().join('/')}`,
  };
}

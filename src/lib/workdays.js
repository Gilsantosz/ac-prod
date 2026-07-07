// Cálculo de dias úteis com calendário manual sobrepondo o padrão seg-sex.

export function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// Constrói um mapa { date: isWorkday } a partir das marcações manuais.
export function calendarMap(entries = []) {
  const map = {};
  entries.forEach((c) => { if (c.date) map[c.date] = c.isWorkday !== false; });
  return map;
}

// Um dia é útil se: marcado manualmente -> usa a marcação; senão -> seg a sex.
export function isWorkdayDate(dateStr, map = {}) {
  if (dateStr in map) return map[dateStr];
  const d = new Date(dateStr + 'T00:00:00');
  const wd = d.getDay();
  return wd !== 0 && wd !== 6;
}

// Total de dias úteis de um mês considerando o calendário manual.
export function workdaysInMonth(month, map = {}) {
  return monthDates(month).filter((d) => isWorkdayDate(d, map)).length;
}

export function workdayDatesInMonth(month, map = {}) {
  return monthDates(month).filter((d) => isWorkdayDate(d, map));
}

// Meta diária = meta mensal / dias úteis do mês.
export function dailyTargetFromMonthly(monthlyTarget, month, map = {}) {
  const wd = workdaysInMonth(month, map);
  if (!wd) return 0;
  return Math.round((Number(monthlyTarget) || 0) / wd);
}

export function dailyDistributionFromMonthly(monthlyTarget, month, map = {}) {
  const dates = workdayDatesInMonth(month, map);
  if (!dates.length) return [];

  const total = Math.max(0, Math.round(Number(monthlyTarget) || 0));
  const base = Math.floor(total / dates.length);
  const remainder = total % dates.length;

  return dates.map((date, index) => ({
    date,
    quantity: base + (index < remainder ? 1 : 0),
  }));
}

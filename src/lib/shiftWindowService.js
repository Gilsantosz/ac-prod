/**
 * AC.Prod2 — Serviço de Cálculo de Janela de Turno do Operador
 *
 * Suporta turnos diurnos (ex: 06:00-14:00) e noturnos que cruzam a meia-noite (ex: 22:00-06:00)
 * com timezone explícito (default: America/Sao_Paulo).
 */

export function resolveOperatorShiftWindow({
  operatorId = null,
  shiftStartTime = '06:00:00',
  shiftEndTime = '14:00:00',
  timezone = 'America/Sao_Paulo',
  referenceTime = new Date()
} = {}) {
  const refDate = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
  
  // Extrair componentes no fuso horário do operador
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(refDate).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const currentYear = Number(parts.year);
  const currentMonth = Number(parts.month) - 1;
  const currentDay = Number(parts.day);
  const currentHour = Number(parts.hour);
  const currentMinute = Number(parts.minute);
  const currentSecond = Number(parts.second);

  const [startH, startM = 0] = String(shiftStartTime).split(':').map(Number);
  const [endH, endM = 0] = String(shiftEndTime).split(':').map(Number);

  const currentMinutesTotal = currentHour * 60 + currentMinute + currentSecond / 60;
  const startMinutesTotal = startH * 60 + startM;
  const endMinutesTotal = endH * 60 + endM;

  let isInside = false;
  let workDateYear = currentYear;
  let workDateMonth = currentMonth;
  let workDateDay = currentDay;

  let startYear = currentYear;
  let startMonth = currentMonth;
  let startDay = currentDay;

  let endYear = currentYear;
  let endMonth = currentMonth;
  let endDay = currentDay;

  if (startMinutesTotal < endMinutesTotal) {
    // Turno Diurno (ex: 06:00 às 14:00)
    if (currentMinutesTotal >= startMinutesTotal && currentMinutesTotal < endMinutesTotal) {
      isInside = true;
    }
  } else {
    // Turno Noturno que cruza meia-noite (ex: 22:00 às 06:00)
    if (currentMinutesTotal >= startMinutesTotal) {
      // Noite do dia X
      isInside = true;
      endDay += 1;
    } else if (currentMinutesTotal < endMinutesTotal) {
      // Madrugada do dia X+1 -> Data de trabalho é o dia anterior
      isInside = true;
      workDateDay -= 1;
      startDay -= 1;
    } else {
      // Fora da janela (ex: 12:00)
      endDay += 1;
    }
  }

  const shiftStartedAt = new Date(Date.UTC(startYear, startMonth, startDay, startH + 3, startM, 0)); // Brasil UTC-3 approx fallback
  const shiftEndsAt = new Date(Date.UTC(endYear, endMonth, endDay, endH + 3, endM, 0));

  const workDateString = `${workDateYear}-${String(workDateMonth + 1).padStart(2, '0')}-${String(workDateDay).padStart(2, '0')}`;

  return {
    operatorId,
    timezone,
    shiftStartTime,
    shiftEndTime,
    shiftWorkDate: workDateString,
    shiftStartedAt: shiftStartedAt.toISOString(),
    shiftEndsAt: shiftEndsAt.toISOString(),
    isInsideShift: isInside,
  };
}

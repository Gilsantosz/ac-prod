// Métricas de análise de paradas (downtime) a partir das Ocorrências.
import { format, parseISO } from 'date-fns';

// Top N motivos de parada por célula (por tempo total de parada).
export function topReasonsByCell(occurrences, topN = 5) {
  const byCell = {};
  occurrences.forEach((o) => {
    if (!o.cell) return;
    const cell = o.cell;
    const reason = o.reason || 'Outros';
    byCell[cell] = byCell[cell] || {};
    byCell[cell][reason] = (byCell[cell][reason] || 0) + (Number(o.downtime) || 0);
  });

  return Object.entries(byCell).map(([cell, reasons]) => ({
    cell,
    reasons: Object.entries(reasons)
      .map(([reason, downtime]) => ({ reason, downtime }))
      .sort((a, b) => b.downtime - a.downtime)
      .slice(0, topN),
  }));
}

// Frequência de ocorrências ao longo do tempo (por data).
export function frequencyOverTime(occurrences) {
  const byDate = {};
  occurrences.forEach((o) => {
    if (!o.date) return;
    byDate[o.date] = byDate[o.date] || { count: 0, downtime: 0 };
    byDate[o.date].count += 1;
    byDate[o.date].downtime += Number(o.downtime) || 0;
  });

  return Object.entries(byDate)
    .map(([date, v]) => ({
      date,
      label: safeLabel(date),
      count: v.count,
      downtime: v.downtime,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// MTTR (tempo médio de reparo) por tipo de ocorrência = média do downtime por motivo.
export function mttrByReason(occurrences) {
  const byReason = {};
  occurrences.forEach((o) => {
    const reason = o.reason || 'Outros';
    byReason[reason] = byReason[reason] || { total: 0, count: 0 };
    byReason[reason].total += Number(o.downtime) || 0;
    byReason[reason].count += 1;
  });

  return Object.entries(byReason)
    .map(([reason, v]) => ({
      reason,
      mttr: v.count > 0 ? Math.round((v.total / v.count) * 10) / 10 : 0,
      count: v.count,
      total: v.total,
    }))
    .sort((a, b) => b.mttr - a.mttr);
}

function safeLabel(date) {
  try {
    return format(parseISO(date), 'dd/MM');
  } catch {
    return date;
  }
}
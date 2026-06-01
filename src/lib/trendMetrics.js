// Evolução diária de OEE e produtividade por célula ao longo de um mês.
import { computeOEE } from '@/lib/oeeMetrics';

// Lista de datas (yyyy-MM-dd) de um mês "yyyy-MM".
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// Produtividade (%) = produzido / meta.
function productivity(entries) {
  const produced = entries.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const target = entries.reduce((a, e) => a + (Number(e.target) || 0), 0);
  return target > 0 ? Math.round((produced / target) * 100 * 10) / 10 : 0;
}

// Séries diárias para um conjunto de entradas (uma célula ou geral).
// Retorna [{ date, day, oee, productivity, produced }]
export function dailySeries(entries, month, getCell) {
  const byDate = {};
  entries.forEach((e) => {
    if (!e.date) return;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });
  return monthDays(month).map((date) => {
    const list = byDate[date] || [];
    const oee = list.length ? computeOEE(list, getCell).oee : null;
    const prod = list.length ? productivity(list) : null;
    const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
    return { date, day: Number(date.slice(-2)), oee, productivity: prod, produced };
  });
}

// Tendência: compara média da 1ª metade com a 2ª metade do mês.
export function trendDirection(series, key) {
  const valid = series.filter((p) => p[key] != null);
  if (valid.length < 4) return { delta: 0, dir: 'flat' };
  const mid = Math.floor(valid.length / 2);
  const avg = (arr) => arr.reduce((a, p) => a + p[key], 0) / (arr.length || 1);
  const first = avg(valid.slice(0, mid));
  const second = avg(valid.slice(mid));
  const delta = Math.round((second - first) * 10) / 10;
  return { delta, dir: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat' };
}

// Agrupa por célula e gera séries por célula para um mês.
export function seriesByCell(entries, month, getCell) {
  const byCell = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCell[e.cell] = byCell[e.cell] || []).push(e);
  });
  return Object.entries(byCell)
    .map(([cell, list]) => ({ cell, series: dailySeries(list, month, getCell) }))
    .sort((a, b) => a.cell.localeCompare(b.cell));
}
// Métricas mensais para relatórios analíticos
import { efficiency, scrapRate } from '@/lib/productionMetrics';

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthKey(dateStr) {
  // dateStr = 'yyyy-MM-dd'
  return dateStr ? dateStr.slice(0, 7) : null;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTHS_PT[Number(m) - 1]}/${y.slice(2)}`;
}

// Série mensal agregada de toda a produção
export function monthlySeries(entries) {
  const map = {};
  entries.forEach((e) => {
    const k = monthKey(e.date);
    if (!k) return;
    if (!map[k]) map[k] = { key: k, produced: 0, target: 0, scrap: 0, downtime: 0, count: 0 };
    map[k].produced += Number(e.produced) || 0;
    map[k].target += Number(e.target) || 0;
    map[k].scrap += Number(e.scrap) || 0;
    map[k].downtime += Number(e.downtime) || 0;
    map[k].count += 1;
  });
  return Object.values(map)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => ({
      ...g,
      label: monthLabel(g.key),
      efficiency: efficiency(g.produced, g.target),
      scrapRate: scrapRate(g.scrap, g.produced),
    }));
}

// Série mensal por célula -> { months: [labels], cells: [name], rows: [{ label, [cell]: produced }] }
export function monthlyByCell(entries) {
  const cells = [...new Set(entries.map((e) => e.cell).filter(Boolean))].sort();
  const map = {};
  entries.forEach((e) => {
    const k = monthKey(e.date);
    if (!k || !e.cell) return;
    if (!map[k]) map[k] = { key: k, label: monthLabel(k) };
    map[k][e.cell] = (map[k][e.cell] || 0) + (Number(e.produced) || 0);
  });
  const rows = Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  // garante que toda célula exista em todas as linhas (0 quando ausente)
  rows.forEach((r) => cells.forEach((c) => { if (r[c] == null) r[c] = 0; }));
  return { cells, rows };
}

// Compara o mês mais recente com o anterior
export function monthOverMonth(series) {
  if (series.length < 2) return null;
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const diff = prev.produced ? Math.round(((cur.produced - prev.produced) / prev.produced) * 1000) / 10 : 0;
  return { cur, prev, diffPct: diff };
}

// Eficiência mensal por célula: { cell -> [{ key, label, efficiency }] }
function monthlyEfficiencyByCell(entries) {
  const map = {};
  entries.forEach((e) => {
    const k = monthKey(e.date);
    if (!k || !e.cell) return;
    const id = `${e.cell}__${k}`;
    if (!map[id]) map[id] = { cell: e.cell, key: k, produced: 0, target: 0 };
    map[id].produced += Number(e.produced) || 0;
    map[id].target += Number(e.target) || 0;
  });
  const byCell = {};
  Object.values(map).forEach((g) => {
    if (!byCell[g.cell]) byCell[g.cell] = [];
    byCell[g.cell].push({ key: g.key, label: monthLabel(g.key), efficiency: efficiency(g.produced, g.target) });
  });
  Object.values(byCell).forEach((arr) => arr.sort((a, b) => a.key.localeCompare(b.key)));
  return byCell;
}

// Detecta células com queda de eficiência acima do limite (%) vs mês anterior
export function seasonalityAlerts(entries, minDropPct = 15) {
  const byCell = monthlyEfficiencyByCell(entries);
  const alerts = [];
  Object.entries(byCell).forEach(([cell, months]) => {
    if (months.length < 2) return;
    const cur = months[months.length - 1];
    const prev = months[months.length - 2];
    if (!prev.efficiency) return;
    const drop = prev.efficiency - cur.efficiency;
    if (drop >= minDropPct) {
      alerts.push({
        cell,
        fromLabel: prev.label,
        toLabel: cur.label,
        fromEff: prev.efficiency,
        toEff: cur.efficiency,
        drop: Math.round(drop),
      });
    }
  });
  return alerts.sort((a, b) => b.drop - a.drop);
}

// Resumo executivo agregado do período filtrado
export function executiveSummary(entries) {
  const produced = entries.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const target = entries.reduce((a, e) => a + (Number(e.target) || 0), 0);
  const scrap = entries.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = entries.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  return {
    oee: efficiency(produced, target),
    produced,
    scrapRate: scrapRate(scrap, produced),
    downtime,
  };
}

// Projeta a meta do próximo mês com base na média móvel e tendência recente
export function nextMonthProjection(series) {
  if (series.length < 2) return null;
  const recent = series.slice(-3);
  const avgProduced = Math.round(recent.reduce((a, s) => a + s.produced, 0) / recent.length);
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const trendPct = prev.produced ? ((cur.produced - prev.produced) / prev.produced) * 100 : 0;
  // projeção = média móvel ajustada pela tendência recente (suavizada)
  const projected = Math.round(avgProduced * (1 + (trendPct / 100) * 0.5));
  const avgEff = Math.round(recent.reduce((a, s) => a + s.efficiency, 0) / recent.length);

  // sugestões de alocação com base na tendência e eficiência
  const suggestions = [];
  if (trendPct > 5) {
    suggestions.push(`Demanda em alta (+${Math.round(trendPct)}%): reforce a equipe e antecipe manutenção das máquinas para evitar gargalos.`);
  } else if (trendPct < -5) {
    suggestions.push(`Demanda em queda (${Math.round(trendPct)}%): realoque operadores para células mais demandadas e reduza horas extras.`);
  } else {
    suggestions.push('Demanda estável: mantenha a alocação atual de pessoal e máquinas.');
  }
  if (avgEff < 80) {
    suggestions.push(`Eficiência média baixa (${avgEff}%): priorize treinamento e revise setups para liberar capacidade.`);
  }

  return { projected, avgProduced, trendPct: Math.round(trendPct * 10) / 10, avgEff, nextLabel: nextMonthLabel(cur.key), suggestions };
}

function nextMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 1); // m já aponta para o próximo mês (0-indexed)
  const nk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return monthLabel(nk);
}

// Séries mensais de métricas por célula para benchmarking comparativo
// retorna { months: [keys], labels: [labels], byCell: { cell -> { [key]: { efficiency, scrapRate, downtime } } } }
export function cellBenchmark(entries) {
  const agg = {};
  const monthsSet = new Set();
  entries.forEach((e) => {
    const k = monthKey(e.date);
    if (!k || !e.cell) return;
    monthsSet.add(k);
    const id = `${e.cell}__${k}`;
    if (!agg[id]) agg[id] = { cell: e.cell, key: k, produced: 0, target: 0, scrap: 0, downtime: 0 };
    agg[id].produced += Number(e.produced) || 0;
    agg[id].target += Number(e.target) || 0;
    agg[id].scrap += Number(e.scrap) || 0;
    agg[id].downtime += Number(e.downtime) || 0;
  });
  const months = [...monthsSet].sort();
  const labels = months.map(monthLabel);
  const byCell = {};
  Object.values(agg).forEach((g) => {
    if (!byCell[g.cell]) byCell[g.cell] = {};
    byCell[g.cell][g.key] = {
      efficiency: efficiency(g.produced, g.target),
      scrapRate: scrapRate(g.scrap, g.produced),
      downtime: g.downtime,
    };
  });
  const cells = Object.keys(byCell).sort();
  return { months, labels, byCell, cells };
}

export const CELL_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', '#8b5cf6', '#06b6d4', '#f97316',
];
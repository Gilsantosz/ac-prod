// Funções de cálculo de produtividade
import { buildProductionMetric, getProductionMetricRule } from '@/lib/productionUnitRules';

export function efficiency(produced, target) {
  if (!target) return produced > 0 ? 100 : 0;
  return Math.round((produced / target) * 100);
}

export function scrapRate(scrap, produced) {
  const total = (scrap || 0) + (produced || 0);
  if (!total) return 0;
  return Math.round(((scrap || 0) / total) * 1000) / 10;
}

export function isValidProductionEntry(entry = {}) {
  return !entry.approval_status || entry.approval_status === 'valid';
}

function validProductionEntries(entries = []) {
  return (entries || []).filter(isValidProductionEntry);
}

export function sumBy(entries, key) {
  return validProductionEntries(entries).reduce((acc, e) => acc + (Number(e[key]) || 0), 0);
}

export function difference(realized, base) {
  return (Number(realized) || 0) - (Number(base) || 0);
}

function unitAwareKey(entry, includeShift = false) {
  const cell = entry.cell || entry.cellName || entry.cell_name || '—';
  const shift = entry.shift || '—';
  const rule = getProductionMetricRule(entry);
  return {
    key: includeShift ? `${shift}||${cell}||${rule.unit}` : `${cell}||${rule.unit}`,
    shift,
    cell,
    unit: rule.unit,
    unitLabel: rule.unitLabel,
    metricName: rule.metricName,
  };
}

function addUnitAware(map, entry, includeShift = false) {
  const ctx = unitAwareKey(entry, includeShift);
  const metric = buildProductionMetric(entry);
  const current = map.get(ctx.key) || {
    key: ctx.key,
    shift: ctx.shift,
    cell: ctx.cell,
    metric_unit: ctx.unit,
    unitLabel: ctx.unitLabel,
    metricName: ctx.metricName,
    realized: 0,
    target: 0,
    capacity: 0,
    scrap: 0,
    downtime: 0,
    count: 0,
  };
  current.realized += Number(metric.realized_quantity) || 0;
  current.target += Number(metric.planned_target) || Number(entry.target) || 0;
  current.capacity += Number(metric.planned_capacity) || Number(entry.planned_capacity) || 0;
  current.scrap += Number(entry.scrap) || 0;
  current.downtime += Number(entry.downtime) || 0;
  current.count += 1;
  map.set(ctx.key, current);
}

function finalizeUnitAware(list) {
  return list.map((row) => ({
    ...row,
    produced: row.realized,
    good: Math.max(row.realized - row.scrap, 0),
    differenceTarget: difference(row.realized, row.target),
    differenceCapacity: difference(row.realized, row.capacity),
    efficiency: efficiency(row.realized, row.target),
    efficiencyCapacity: efficiency(row.realized, row.capacity),
    scrapRate: scrapRate(row.scrap, row.realized),
  }));
}

export function groupByCellUnit(entries = []) {
  const map = new Map();
  validProductionEntries(entries).forEach((entry) => addUnitAware(map, entry, false));
  return finalizeUnitAware([...map.values()]);
}

export function groupByShiftCellUnit(entries = []) {
  const map = new Map();
  validProductionEntries(entries).forEach((entry) => addUnitAware(map, entry, true));
  return finalizeUnitAware([...map.values()]);
}

export function summarizeByUnit(entries = []) {
  const map = new Map();
  groupByCellUnit(entries).forEach((row) => {
    const current = map.get(row.metric_unit) || {
      key: row.metric_unit,
      metric_unit: row.metric_unit,
      unitLabel: row.unitLabel,
      realized: 0,
      target: 0,
      capacity: 0,
      scrap: 0,
      downtime: 0,
      count: 0,
    };
    current.realized += row.realized;
    current.target += row.target;
    current.capacity += row.capacity;
    current.scrap += row.scrap;
    current.downtime += row.downtime;
    current.count += row.count;
    map.set(row.metric_unit, current);
  });
  return finalizeUnitAware([...map.values()]);
}

// Agrupa entradas por um campo e calcula totais
export function groupBy(entries, field) {
  const map = {};
  validProductionEntries(entries).forEach((e) => {
    const k = e[field] || '—';
    if (!map[k]) map[k] = { key: k, produced: 0, target: 0, scrap: 0, downtime: 0, count: 0 };
    map[k].produced += Number(e.produced) || 0;
    map[k].target += Number(e.target) || 0;
    map[k].scrap += Number(e.scrap) || 0;
    map[k].downtime += Number(e.downtime) || 0;
    map[k].count += 1;
  });
  return Object.values(map).map((g) => ({
    ...g,
    efficiency: efficiency(g.produced, g.target),
    scrapRate: scrapRate(g.scrap, g.produced),
  }));
}

export function sortByHour(grouped) {
  return [...grouped].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

// Agrupa por célula e retorna as que atingiram >= threshold% da meta diária
export function highPerformers(entries, threshold = 95) {
  const groups = groupBy(entries, 'cell');
  return groups
    .filter((g) => g.target > 0 && g.efficiency >= threshold)
    .sort((a, b) => b.efficiency - a.efficiency);
}

// Projeta a conclusão da meta diária com base no ritmo das últimas N horas
export function projectGoal(entries, lastHours = 3) {
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  if (!totalTarget) return null;

  // ordena horas trabalhadas e pega as últimas N
  const hours = sortByHour(groupBy(entries, 'hour'));
  if (!hours.length) return null;
  const recent = hours.slice(-lastHours);
  const pacePerHour = sumBy(recent, 'produced') / recent.length;

  const remaining = Math.max(totalTarget - totalProduced, 0);
  const hoursNeeded = pacePerHour > 0 ? remaining / pacePerHour : Infinity;
  const projected = totalProduced + pacePerHour * (24 - hours.length); // estimativa simples do restante do dia
  const willMeet = pacePerHour > 0 && (totalProduced + pacePerHour) >= remaining ? true : remaining === 0;

  return {
    totalProduced,
    totalTarget,
    remaining,
    pacePerHour: Math.round(pacePerHour),
    hoursNeeded: isFinite(hoursNeeded) ? Math.ceil(hoursNeeded) : null,
    projectedTotal: Math.round(projected),
    atRisk: remaining > 0 && (pacePerHour <= 0 || projected < totalTarget),
    completedPct: efficiency(totalProduced, totalTarget),
  };
}

// Detecta padrão de queda de eficiência nas últimas horas e sugere ação preventiva
export function detectEfficiencyDrop(entries, lastHours = 3, minDropPct = 10) {
  const hours = sortByHour(groupBy(entries, 'hour')).filter((h) => h.target > 0);
  if (hours.length < lastHours) return null;

  const recent = hours.slice(-lastHours);
  const effs = recent.map((h) => h.efficiency);
  const first = effs[0];
  const last = effs[effs.length - 1];
  const drop = first - last;

  // Verifica tendência consistentemente decrescente
  let declining = true;
  for (let i = 1; i < effs.length; i++) {
    if (effs[i] > effs[i - 1]) { declining = false; break; }
  }

  const highDowntime = sumBy(recent, 'downtime') >= 30;
  const triggered = (declining && drop >= minDropPct) || (drop >= minDropPct && highDowntime);
  if (!triggered) return null;

  const suggestions = [];
  if (highDowntime) suggestions.push('Inspecionar a máquina — paradas acumuladas nas últimas horas.');
  if (last < 70) suggestions.push('Revisar a alocação de pessoal na célula afetada.');
  suggestions.push('Verificar abastecimento de material e setup do equipamento.');

  return {
    fromEff: first,
    toEff: last,
    drop: Math.round(drop),
    hours: recent.map((h) => h.key),
    downtime: sumBy(recent, 'downtime'),
    suggestions,
  };
}

// Acompanhamento da meta mensal: produção acumulada do mês vs. meta e previsão até o fim do mês
export function monthlyGoalTracking(entries, goals, now = new Date()) {
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inMonth = (d) => typeof d === 'string' && d.startsWith(ym);
  const validEntries = validProductionEntries(entries);

  const produced = validEntries.filter((e) => inMonth(e.date)).reduce((a, e) => a + (Number(e.produced) || 0), 0);
  // meta mensal = soma das metas diárias definidas no mês; fallback para metas das entradas
  let target = goals.filter((g) => inMonth(g.date)).reduce((a, g) => a + (Number(g.target) || 0), 0);
  if (!target) target = validEntries.filter((e) => inMonth(e.date)).reduce((a, e) => a + (Number(e.target) || 0), 0);
  if (!target) return null;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const dailyPace = produced / dayOfMonth;
  const projectedTotal = Math.round(dailyPace * daysInMonth);
  const completedPct = Math.round((produced / target) * 100);
  const projectedPct = Math.round((projectedTotal / target) * 100);
  const remaining = Math.max(target - produced, 0);
  const daysLeft = daysInMonth - dayOfMonth;
  const neededPerDay = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;

  return {
    produced,
    target,
    remaining,
    completedPct,
    projectedTotal,
    projectedPct,
    dailyPace: Math.round(dailyPace),
    neededPerDay,
    daysLeft,
    daysInMonth,
    willMeet: projectedTotal >= target,
    monthLabel: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

// Detecta células com eficiência abaixo de `minEff`% por `minHours`+ horas consecutivas.
// Retorna uma lista de alertas (uma por célula em estado crítico sustentado).
export function detectSustainedLowEfficiency(entries, minEff = 70, minHours = 3) {
  const byCell = {};
  validProductionEntries(entries).forEach((e) => {
    if (!e.cell || !e.hour || !(Number(e.target) > 0)) return;
    const k = e.cell;
    if (!byCell[k]) byCell[k] = {};
    const h = e.hour;
    if (!byCell[k][h]) byCell[k][h] = { produced: 0, target: 0 };
    byCell[k][h].produced += Number(e.produced) || 0;
    byCell[k][h].target += Number(e.target) || 0;
  });

  const alerts = [];
  Object.entries(byCell).forEach(([cell, hoursMap]) => {
    const hours = Object.keys(hoursMap).sort((a, b) => a.localeCompare(b));
    // encontra a maior sequência consecutiva de horas com eff < minEff
    let runStart = -1;
    let bestRun = null;
    for (let i = 0; i <= hours.length; i++) {
      const h = hours[i];
      const data = h ? hoursMap[h] : null;
      const eff = data ? efficiency(data.produced, data.target) : null;
      const low = eff !== null && eff < minEff;
      if (low) {
        if (runStart === -1) runStart = i;
      } else {
        if (runStart !== -1) {
          const run = hours.slice(runStart, i);
          if (!bestRun || run.length > bestRun.length) bestRun = run;
          runStart = -1;
        }
      }
    }
    if (bestRun && bestRun.length >= minHours) {
      const lastH = bestRun[bestRun.length - 1];
      const lastEff = efficiency(hoursMap[lastH].produced, hoursMap[lastH].target);
      alerts.push({
        cell,
        hours: bestRun,
        consecutive: bestRun.length,
        currentEff: lastEff,
        threshold: minEff,
      });
    }
  });
  return alerts;
}

// Série de eficiência diária dos últimos N dias para uma célula (ou todas se cell = 'all')
export function efficiencyTrend(entries, cell = 'all', days = 7, endDate = new Date()) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayEntries = entries.filter(
      (e) => isValidProductionEntry(e) && e.date === iso && (cell === 'all' || e.cell === cell)
    );
    const produced = sumBy(dayEntries, 'produced');
    const target = sumBy(dayEntries, 'target');
    const scrap = sumBy(dayEntries, 'scrap');
    result.push({
      date: iso,
      label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      efficiency: efficiency(produced, target),
      scrapRate: scrapRate(scrap, produced),
      produced,
      target,
    });
  }
  return result;
}

// Detecta se uma entrada é falha crítica (eficiência < 50% com meta definida, ou parada longa)
export function isCritical(entry, threshold = 50) {
  const eff = efficiency(Number(entry.produced), Number(entry.target));
  const hasTarget = Number(entry.target) > 0;
  return (hasTarget && eff < threshold) || Number(entry.downtime) >= 60;
}

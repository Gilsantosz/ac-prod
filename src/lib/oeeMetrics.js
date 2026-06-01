// Cálculo de OEE (Overall Equipment Effectiveness)
// OEE = Disponibilidade × Performance × Qualidade

import { HOURS_KEY } from '@/hooks/useCells';

const pct = (n) => Math.round(n * 100 * 10) / 10; // fração 0-1 → % com 1 casa

// Calcula os 3 componentes do OEE para um conjunto de entradas.
// `getCell` resolve o cadastro da célula (para tempo planejado por turno).
export function computeOEE(entries, getCell) {
  const produced = entries.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const target = entries.reduce((a, e) => a + (Number(e.target) || 0), 0);
  const scrap = entries.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtimeMin = entries.reduce((a, e) => a + (Number(e.downtime) || 0), 0);

  // Tempo planejado (min): soma das horas de turno de cada combinação célula+turno+data
  const seen = new Set();
  let plannedMin = 0;
  entries.forEach((e) => {
    const k = `${e.date}|${e.cell}|${e.shift}`;
    if (seen.has(k)) return;
    seen.add(k);
    const cell = getCell ? getCell(e.cell) : null;
    const hours = cell ? (cell[HOURS_KEY[e.shift]] ?? 8) : 8;
    plannedMin += hours * 60;
  });

  const operatingMin = Math.max(plannedMin - downtimeMin, 0);
  const availability = plannedMin > 0 ? operatingMin / plannedMin : 0;
  const performance = target > 0 ? Math.min(produced / target, 1.5) : 0;
  const goodParts = Math.max(produced - scrap, 0);
  const quality = produced > 0 ? goodParts / produced : 0;
  const oee = availability * performance * quality;

  return {
    availability: pct(availability),
    performance: pct(performance),
    quality: pct(quality),
    oee: pct(oee),
    plannedMin,
    operatingMin,
    downtimeMin,
    produced,
    target,
    scrap,
    goodParts,
  };
}

// OEE agregado por célula — para comparar onde a eficiência é mais perdida.
export function oeeByCell(entries, getCell) {
  const byCell = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCell[e.cell] = byCell[e.cell] || []).push(e);
  });
  return Object.entries(byCell)
    .map(([cell, list]) => ({ cell, ...computeOEE(list, getCell) }))
    .sort((a, b) => a.oee - b.oee); // pior primeiro
}

// Identifica qual fator mais derruba o OEE de cada célula
export function worstFactor(row) {
  const factors = [
    { key: 'availability', label: 'Disponibilidade', value: row.availability },
    { key: 'performance', label: 'Performance', value: row.performance },
    { key: 'quality', label: 'Qualidade', value: row.quality },
  ];
  return factors.sort((a, b) => a.value - b.value)[0];
}
import { startOfWeek, endOfWeek, parseISO, isWithinInterval } from 'date-fns';

// Ranking de células com base na produção da semana corrente vs. metas semanais.
// Agrega produzido e meta por célula dentro da semana (segunda a domingo) que
// contém a data de referência. Retorna ordenado pela maior atingimento de meta.
export function weeklyRanking(entries, goals, refDate = new Date()) {
  const ref = typeof refDate === 'string' ? parseISO(refDate) : refDate;
  const start = startOfWeek(ref, { weekStartsOn: 1 });
  const end = endOfWeek(ref, { weekStartsOn: 1 });
  const inWeek = (d) => {
    try { return isWithinInterval(parseISO(d), { start, end }); } catch { return false; }
  };

  const byCell = {};
  const add = (cell, key, val) => {
    if (!cell) return;
    byCell[cell] = byCell[cell] || { cell, produced: 0, target: 0, scrap: 0 };
    byCell[cell][key] += Number(val) || 0;
  };

  entries.forEach((e) => {
    if (!inWeek(e.date)) return;
    add(e.cell, 'produced', e.produced);
    add(e.cell, 'scrap', e.scrap);
  });

  goals.forEach((g) => {
    if (!inWeek(g.date)) return;
    add(g.cell, 'target', g.target);
  });

  return Object.values(byCell)
    .filter((r) => r.target > 0 || r.produced > 0)
    .map((r) => ({
      ...r,
      attainment: r.target > 0 ? Math.round((r.produced / r.target) * 1000) / 10 : 0,
      metGoal: r.target > 0 && r.produced >= r.target,
    }))
    .sort((a, b) => b.attainment - a.attainment);
}

// Medalha por posição/atingimento
export function medalFor(index, row) {
  if (!row.metGoal && index > 2) return null;
  if (index === 0) return { tier: 'gold', label: 'Ouro', color: '#facc15' };
  if (index === 1) return { tier: 'silver', label: 'Prata', color: '#cbd5e1' };
  if (index === 2) return { tier: 'bronze', label: 'Bronze', color: '#d97706' };
  return null;
}
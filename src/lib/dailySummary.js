// Consolida métricas de produção do dia para a tela de Resumo Diário.

function acc(list) {
  const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const target = list.reduce((a, e) => a + (Number(e.target) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, target, scrapRate };
}

// Resumo total + granular por célula e por turno.
export function buildDailySummary(entries) {
  const total = acc(entries);

  const byCellMap = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCellMap[e.cell] = byCellMap[e.cell] || []).push(e);
  });
  const byCell = Object.entries(byCellMap)
    .map(([cell, list]) => ({ cell, ...acc(list) }))
    .sort((a, b) => b.produced - a.produced);

  const byShiftMap = {};
  entries.forEach((e) => {
    const s = e.shift || '—';
    (byShiftMap[s] = byShiftMap[s] || []).push(e);
  });
  const byShift = Object.entries(byShiftMap)
    .map(([shift, list]) => ({ shift, ...acc(list) }))
    .sort((a, b) => a.shift.localeCompare(b.shift));

  return { total, byCell, byShift };
}
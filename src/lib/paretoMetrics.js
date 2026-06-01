// Agrega ocorrências por motivo e calcula o acumulado para o gráfico de Pareto
export function buildPareto(occurrences, valueKey = 'downtime') {
  const totals = {};
  occurrences.forEach((o) => {
    const k = o.reason || 'Outros';
    totals[k] = (totals[k] || 0) + (Number(o[valueKey]) || 0);
  });

  const sorted = Object.entries(totals)
    .map(([reason, value]) => ({ reason, value }))
    .sort((a, b) => b.value - a.value);

  const grandTotal = sorted.reduce((s, d) => s + d.value, 0) || 1;

  let running = 0;
  return sorted.map((d) => {
    running += d.value;
    return {
      ...d,
      percent: Math.round((d.value / grandTotal) * 100),
      cumulative: Math.round((running / grandTotal) * 100),
    };
  });
}
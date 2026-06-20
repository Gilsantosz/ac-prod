function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function percent(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function groupByCell(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const cell = entry.cell || 'Sem célula';
    const current = groups.get(cell) || { cell, produced: 0, target: 0, scrap: 0, downtime: 0, records: 0 };
    current.produced += Number(entry.produced) || 0;
    current.target += Number(entry.target) || 0;
    current.scrap += Number(entry.scrap) || 0;
    current.downtime += Number(entry.downtime) || 0;
    current.records += 1;
    groups.set(cell, current);
  });
  return [...groups.values()].map((item) => ({
    ...item,
    efficiency: percent(item.produced, item.target),
    scrapRate: percent(item.scrap, item.produced),
  })).sort((a, b) => a.efficiency - b.efficiency);
}

export function analyzeProductionContext(context) {
  const { entries = [], occurrences = [], lots = [] } = context;
  const produced = sum(entries, 'produced');
  const target = sum(entries, 'target');
  const scrap = sum(entries, 'scrap');
  const downtime = sum(entries, 'downtime');
  const occurrenceDowntime = sum(occurrences, 'downtime');
  const byCell = groupByCell(entries);
  const blockedLots = lots.filter((lot) => lot.status === 'blocked');
  const completedLots = lots.filter((lot) => lot.current_stage === 'completed' || lot.status === 'shipped');
  const lateLots = lots.filter((lot) => {
    const due = lot.production_orders?.delivery_date;
    return due && new Date(`${due}T23:59:59`) < new Date() && !['completed', 'shipped', 'cancelled'].includes(lot.status);
  });
  const reasons = new Map();
  occurrences.forEach((item) => {
    const reason = item.reason || 'Sem motivo informado';
    reasons.set(reason, (reasons.get(reason) || 0) + (Number(item.downtime) || 0));
  });
  const topReasons = [...reasons.entries()]
    .map(([reason, minutes]) => ({ reason, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const efficiency = percent(produced, target);
  const scrapRate = percent(scrap, produced);
  const insights = [];
  if (!entries.length && !lots.length) {
    insights.push({ severity: 'info', title: 'Sem dados no período', detail: 'Não há produção ou lotes suficientes para uma análise confiável.' });
  } else {
    if (target > 0 && efficiency < 80) insights.push({ severity: 'critical', title: 'Eficiência abaixo de 80%', detail: `A eficiência calculada é ${efficiency.toFixed(1)}% no período selecionado.` });
    else if (target > 0 && efficiency < 95) insights.push({ severity: 'warning', title: 'Meta sob atenção', detail: `A produção atingiu ${efficiency.toFixed(1)}% da meta.` });
    else if (target > 0) insights.push({ severity: 'success', title: 'Meta produtiva consistente', detail: `A produção atingiu ${efficiency.toFixed(1)}% da meta.` });
    if (scrapRate > 3) insights.push({ severity: 'warning', title: 'Refugo elevado', detail: `${scrapRate.toFixed(1)}% do volume produzido foi registrado como refugo.` });
    if (topReasons[0]) insights.push({ severity: topReasons[0].minutes >= 120 ? 'critical' : 'warning', title: 'Principal causa de parada', detail: `${topReasons[0].reason}: ${topReasons[0].minutes.toLocaleString('pt-BR')} minutos.` });
    if (blockedLots.length) insights.push({ severity: 'critical', title: 'Lotes bloqueados', detail: `${blockedLots.length} lote(s) exigem tratamento antes de avançar.` });
    if (lateLots.length) insights.push({ severity: 'warning', title: 'Risco de prazo', detail: `${lateLots.length} lote(s) têm entrega vencida e ainda não foram concluídos.` });
  }

  const recommendations = [];
  if (byCell[0]?.target > 0 && byCell[0].efficiency < 90) recommendations.push(`Revisar capacidade, paradas e sequência da célula ${byCell[0].cell}.`);
  if (topReasons[0]) recommendations.push(`Abrir ação para a causa “${topReasons[0].reason}” e acompanhar a redução de minutos.`);
  if (scrapRate > 3) recommendations.push('Conferir material, setup, inspeção e operador nos registros com refugo.');
  if (blockedLots.length) recommendations.push('Priorizar o lote bloqueado mais antigo e registrar motivo e responsável.');
  if (!recommendations.length && entries.length) recommendations.push('Manter o acompanhamento por célula e comparar o próximo período com esta linha de base.');

  return {
    kpis: {
      records: entries.length,
      produced,
      target,
      efficiency,
      scrap,
      scrapRate,
      downtime: Math.max(downtime, occurrenceDowntime),
      occurrences: occurrences.length,
      lots: lots.length,
      blockedLots: blockedLots.length,
      lateLots: lateLots.length,
      completedLots: completedLots.length,
    },
    byCell,
    topReasons,
    insights,
    recommendations,
  };
}

export function formatInsightAnswer(context, analysis) {
  const { kpis } = analysis;
  if (!context.entries.length && !context.lots.length) {
    return `Não encontrei dados produtivos no período de ${context.filters.startDate} a ${context.filters.endDate}. Ajuste os filtros ou confirme se os apontamentos já foram registrados.`;
  }
  const lines = [
    `Análise confirmada de ${context.filters.startDate} a ${context.filters.endDate}:`,
    `Produzido ${kpis.produced.toLocaleString('pt-BR')} de ${kpis.target.toLocaleString('pt-BR')} (${kpis.efficiency.toFixed(1)}% de eficiência).`,
    `Refugo ${kpis.scrap.toLocaleString('pt-BR')} (${kpis.scrapRate.toFixed(1)}%) e ${kpis.downtime.toLocaleString('pt-BR')} min de parada.`,
    `Lotes: ${kpis.lots}; bloqueados: ${kpis.blockedLots}; em atraso: ${kpis.lateLots}; concluídos: ${kpis.completedLots}.`,
  ];
  if (analysis.recommendations.length) {
    lines.push('', 'Ações sugeridas:', ...analysis.recommendations.slice(0, 4).map((item) => `• ${item}`));
  }
  if (context.warnings.length) lines.push('', `Cobertura parcial: ${context.warnings.join(' ')}`);
  return lines.join('\n');
}


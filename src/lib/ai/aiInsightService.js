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

function groupedQuantity(rows, key, fallback) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = row[key] || fallback;
    groups.set(label, (groups.get(label) || 0) + Math.max(1, Number(row.quantity) || 0));
  });
  return [...groups.entries()]
    .map(([label, quantity]) => ({ label, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
}

function isClosedStatus(value) {
  return ['closed', 'resolved', 'completed', 'done', 'cancelled'].includes(String(value || '').toLowerCase());
}

function dateValue(row) {
  const value = row?.date || row?.created_at || row?.detected_at;
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function periodTrend(entries, nonconformities) {
  const dated = [...entries, ...nonconformities].map(dateValue).filter(Boolean);
  if (dated.length < 2) {
    return {
      confidence: 'baixa',
      efficiencyDelta: 0,
      scrapRateDelta: 0,
      nonconformityDelta: 0,
      risk: 'base insuficiente',
      detail: 'É necessário comparar pelo menos dois recortes com dados para projetar uma tendência.',
    };
  }

  const midpoint = (Math.min(...dated) + Math.max(...dated)) / 2;
  const previousEntries = entries.filter((row) => dateValue(row) <= midpoint);
  const recentEntries = entries.filter((row) => dateValue(row) > midpoint);
  const previousNc = nonconformities.filter((row) => dateValue(row) <= midpoint);
  const recentNc = nonconformities.filter((row) => dateValue(row) > midpoint);
  const efficiencyFor = (rows) => percent(sum(rows, 'produced'), sum(rows, 'target'));
  const scrapFor = (rows) => percent(sum(rows, 'scrap'), sum(rows, 'produced'));
  const efficiencyDelta = efficiencyFor(recentEntries) - efficiencyFor(previousEntries);
  const scrapRateDelta = scrapFor(recentEntries) - scrapFor(previousEntries);
  const nonconformityDelta = sum(recentNc, 'quantity') - sum(previousNc, 'quantity');
  const worsening = efficiencyDelta < -5 || scrapRateDelta > 1 || nonconformityDelta > 0;
  const improving = efficiencyDelta > 5 && scrapRateDelta <= 0 && nonconformityDelta <= 0;

  return {
    confidence: entries.length + nonconformities.length >= 14 ? 'média' : 'baixa',
    efficiencyDelta,
    scrapRateDelta,
    nonconformityDelta,
    risk: worsening ? 'elevado' : (improving ? 'reduzindo' : 'estável'),
    detail: worsening
      ? 'O recorte mais recente piorou em pelo menos um indicador relevante.'
      : (improving
        ? 'O recorte mais recente melhorou a eficiência sem aumentar perdas ou não conformidades.'
        : 'Os recortes comparados não mostram variação material suficiente para indicar deterioração.'),
  };
}

export function analyzeProductionContext(context) {
  const {
    entries = [],
    occurrences = [],
    lots = [],
    qualityNonconformities = [],
    qualityActions = [],
  } = context;
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
    const reason = item.reason || item.description || 'Sem motivo informado';
    const minutes = Number(item.downtime ?? item.duration_minutes ?? item.minutes) || 0;
    reasons.set(reason, (reasons.get(reason) || 0) + minutes);
  });
  const topReasons = [...reasons.entries()]
    .map(([reason, minutes]) => ({ reason, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const openNonconformities = qualityNonconformities.filter((item) => !isClosedStatus(item.status));
  const criticalNonconformities = openNonconformities.filter((item) =>
    ['critical', 'critica', 'high', 'alta'].includes(String(item.severity || '').toLowerCase())
  );
  const nonconformingQuantity = sum(qualityNonconformities, 'quantity');
  const topDefects = groupedQuantity(qualityNonconformities, 'defect_name', 'Defeito não informado').slice(0, 5);
  const topQualityCells = groupedQuantity(qualityNonconformities, 'cell_name', 'Célula não informada').slice(0, 5);
  const overdueActions = qualityActions.filter((action) =>
    !isClosedStatus(action.status)
    && action.when_deadline
    && new Date(action.when_deadline).getTime() < Date.now()
  );

  const efficiency = percent(produced, target);
  const scrapRate = percent(scrap, produced);
  const estimatedFpy = produced > 0 ? Math.max(0, percent(produced - scrap, produced)) : 0;
  const insights = [];
  if (!entries.length && !lots.length && !qualityNonconformities.length) {
    insights.push({ severity: 'info', title: 'Sem dados no período', detail: 'Não há produção, lotes ou dados de qualidade suficientes para uma análise confiável.' });
  } else {
    if (target > 0 && efficiency < 80) insights.push({ severity: 'critical', title: 'Eficiência abaixo de 80%', detail: `A eficiência calculada é ${efficiency.toFixed(1)}% no período selecionado.` });
    else if (target > 0 && efficiency < 95) insights.push({ severity: 'warning', title: 'Meta sob atenção', detail: `A produção atingiu ${efficiency.toFixed(1)}% da meta.` });
    else if (target > 0) insights.push({ severity: 'success', title: 'Meta produtiva consistente', detail: `A produção atingiu ${efficiency.toFixed(1)}% da meta.` });
    if (scrapRate > 3) insights.push({ severity: 'warning', title: 'Refugo elevado', detail: `${scrapRate.toFixed(1)}% do volume produzido foi registrado como refugo.` });
    if (topReasons[0]) insights.push({ severity: topReasons[0].minutes >= 120 ? 'critical' : 'warning', title: 'Principal causa de parada', detail: `${topReasons[0].reason}: ${topReasons[0].minutes.toLocaleString('pt-BR')} minutos.` });
    if (blockedLots.length) insights.push({ severity: 'critical', title: 'Lotes bloqueados', detail: `${blockedLots.length} lote(s) exigem tratamento antes de avançar.` });
    if (lateLots.length) insights.push({ severity: 'warning', title: 'Risco de prazo', detail: `${lateLots.length} lote(s) têm entrega vencida e ainda não foram concluídos.` });
    if (openNonconformities.length) insights.push({ severity: criticalNonconformities.length ? 'critical' : 'warning', title: 'Não conformidades abertas', detail: `${openNonconformities.length} registro(s) aberto(s), somando ${sum(openNonconformities, 'quantity')} peça(s).` });
    if (overdueActions.length) insights.push({ severity: 'critical', title: 'Ações da qualidade vencidas', detail: `${overdueActions.length} ação(ões) está(ão) fora do prazo.` });
  }

  const recommendations = [];
  if (topDefects[0]) recommendations.push(`Atacar primeiro o defeito “${topDefects[0].label}”, responsável pelo maior volume de não conformidade (${topDefects[0].quantity}).`);
  if (topQualityCells[0]) recommendations.push(`Revisar padrão, setup e inspeção na célula ${topQualityCells[0].label}, que concentra ${topQualityCells[0].quantity} ocorrência(s) de qualidade.`);
  if (overdueActions.length) recommendations.push(`Regularizar ${overdueActions.length} ação(ões) 5W2H vencida(s), definindo responsável, prazo e evidência de eficácia.`);
  if (byCell[0]?.target > 0 && byCell[0].efficiency < 90) recommendations.push(`Revisar capacidade, paradas e sequência da célula ${byCell[0].cell}.`);
  if (topReasons[0]) recommendations.push(`Abrir ação para a causa “${topReasons[0].reason}” e acompanhar a redução de minutos.`);
  if (scrapRate > 3) recommendations.push('Conferir material, setup, inspeção e operador nos registros com refugo.');
  if (blockedLots.length) recommendations.push('Priorizar o lote bloqueado mais antigo e registrar motivo e responsável.');
  if (!recommendations.length && (entries.length || qualityNonconformities.length)) recommendations.push('Manter o acompanhamento por célula e comparar o próximo período com esta linha de base.');

  return {
    kpis: {
      records: entries.length,
      produced,
      target,
      efficiency,
      scrap,
      scrapRate,
      estimatedFpy,
      downtime: Math.max(downtime, occurrenceDowntime),
      occurrences: occurrences.length,
      lots: lots.length,
      blockedLots: blockedLots.length,
      lateLots: lateLots.length,
      completedLots: completedLots.length,
      nonconformities: qualityNonconformities.length,
      nonconformingQuantity,
      openNonconformities: openNonconformities.length,
      criticalNonconformities: criticalNonconformities.length,
      overdueQualityActions: overdueActions.length,
    },
    byCell,
    topReasons,
    quality: {
      topDefects,
      topCells: topQualityCells,
      openNonconformities,
      overdueActions,
    },
    prediction: periodTrend(entries, qualityNonconformities),
    insights,
    recommendations,
  };
}

function periodLabel(filters = {}) {
  if (!filters.startDate && !filters.endDate) return 'todo o histórico do lote';
  return `${filters.startDate || 'início'} a ${filters.endDate || 'hoje'}`;
}

export function formatInsightAnswer(context, analysis, { focus = 'production' } = {}) {
  const { kpis } = analysis;
  const hasAnyData = context.entries.length
    || context.lots.length
    || context.qualityNonconformities?.length
    || context.occurrences?.length;
  if (!hasAnyData) {
    return `Não encontrei dados produtivos ou de qualidade no período de ${periodLabel(context.filters)}. Ajuste os filtros ou confirme se os apontamentos já foram registrados.`;
  }

  let lines;
  if (focus === 'quality') {
    lines = [
      `Análise de qualidade confirmada de ${periodLabel(context.filters)}:`,
      `Não conformidades: ${kpis.nonconformities} registro(s), ${kpis.nonconformingQuantity} peça(s); abertas: ${kpis.openNonconformities}; críticas: ${kpis.criticalNonconformities}.`,
      `FPY estimado pelos apontamentos de produção/refugo: ${kpis.estimatedFpy.toFixed(1)}%. Ações 5W2H vencidas: ${kpis.overdueQualityActions}.`,
    ];
    if (analysis.quality.topDefects[0]) {
      lines.push(`Pareto principal: ${analysis.quality.topDefects.slice(0, 3).map((item) => `${item.label} (${item.quantity})`).join('; ')}.`);
    }
  } else if (focus === 'downtime') {
    lines = [
      `Análise de paradas confirmada de ${periodLabel(context.filters)}:`,
      `Tempo de parada contabilizado: ${kpis.downtime.toLocaleString('pt-BR')} min em ${kpis.occurrences} ocorrência(s).`,
      analysis.topReasons.length
        ? `Principais causas: ${analysis.topReasons.slice(0, 3).map((item) => `${item.reason} (${item.minutes} min)`).join('; ')}.`
        : 'Não há causa de parada detalhada no recorte.',
    ];
  } else if (focus === 'predictive') {
    const prediction = analysis.prediction;
    lines = [
      `Análise preditiva baseada nos dados de ${periodLabel(context.filters)}:`,
      `Tendência de risco: ${prediction.risk} (confiança ${prediction.confidence}). ${prediction.detail}`,
      `Variação entre os dois recortes: eficiência ${prediction.efficiencyDelta >= 0 ? '+' : ''}${prediction.efficiencyDelta.toFixed(1)} p.p.; refugo ${prediction.scrapRateDelta >= 0 ? '+' : ''}${prediction.scrapRateDelta.toFixed(1)} p.p.; não conformidades ${prediction.nonconformityDelta >= 0 ? '+' : ''}${prediction.nonconformityDelta}.`,
      'Esta é uma estimativa operacional, não uma garantia: a confiança cresce conforme o histórico diário fica mais completo.',
    ];
  } else if (focus === 'lots') {
    lines = [
      `Resumo de lotes confirmado de ${periodLabel(context.filters)}:`,
      `Lotes: ${kpis.lots}; bloqueados: ${kpis.blockedLots}; em atraso: ${kpis.lateLots}; concluídos: ${kpis.completedLots}.`,
      'Informe o código do lote geral ou do lote do cliente para eu detalhar cada etapa da rota, quantidade concluída e previsão.',
    ];
  } else {
    lines = [
      `Análise confirmada de ${periodLabel(context.filters)}:`,
      `Produzido ${kpis.produced.toLocaleString('pt-BR')} de ${kpis.target.toLocaleString('pt-BR')} (${kpis.efficiency.toFixed(1)}% de eficiência).`,
      `Refugo ${kpis.scrap.toLocaleString('pt-BR')} (${kpis.scrapRate.toFixed(1)}%) e ${kpis.downtime.toLocaleString('pt-BR')} min de parada.`,
      `Lotes: ${kpis.lots}; bloqueados: ${kpis.blockedLots}; em atraso: ${kpis.lateLots}; concluídos: ${kpis.completedLots}.`,
    ];
  }

  if (analysis.recommendations.length) {
    lines.push('', 'Ações sugeridas:', ...analysis.recommendations.slice(0, 4).map((item) => `• ${item}`));
  }
  if (context.warnings.length) lines.push('', `Cobertura parcial: ${context.warnings.join(' ')}`);
  return lines.join('\n');
}

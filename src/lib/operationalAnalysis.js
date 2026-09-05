import { isValidProductionEntry } from '@/lib/productionMetrics';
import { getProductionMetricRule } from '@/lib/productionUnitRules';

export const formatMetric = (value) => value == null ? 'Sem base' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const ratio = (value, base) => base > 0 ? value / base * 100 : null;
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeAnalysisEntries(entries = []) {
  return entries.filter(isValidProductionEntry).map((entry) => {
    const rule = getProductionMetricRule(entry);
    return { ...entry, metric_unit: rule.unit, unitLabel: rule.unitLabel,
      produced: numeric(entry.produced), target: numeric(entry.target),
      scrap: numeric(entry.scrap), downtime: numeric(entry.downtime) };
  });
}

export function aggregateAnalysis(entries, keyFor) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = keyFor(entry);
    const row = groups.get(key) || { key, cell: entry.cell || 'Sem célula', metric_unit: entry.metric_unit,
      unitLabel: entry.unitLabel, produced: 0, target: 0, scrap: 0, downtime: 0, count: 0, missingTargets: 0 };
    ['produced', 'target', 'scrap', 'downtime'].forEach((field) => { row[field] += entry[field]; });
    row.count += 1;
    if (entry.target <= 0) row.missingTargets += 1;
    groups.set(key, row);
  });
  return [...groups.values()].map((row) => ({ ...row,
    attainment: row.missingTargets ? null : ratio(row.produced, row.target),
    scrapRate: ratio(row.scrap, row.produced + row.scrap),
    gap: row.missingTargets ? null : Math.max(0, row.target - row.produced),
  }));
}

// Pure, bounded analysis over the already loaded snapshot. No polling or network calls.
export function buildOperationalAnalysis(source = [], previousSource = []) {
  const entries = normalizeAnalysisEntries(source);
  const previous = normalizeAnalysisEntries(previousSource);
  const cells = aggregateAnalysis(entries, (e) => JSON.stringify([e.cell, e.metric_unit]));
  const units = aggregateAnalysis(entries, (e) => e.metric_unit);
  const previousUnits = aggregateAnalysis(previous, (e) => e.metric_unit);
  const downtime = cells.reduce((total, row) => total + row.downtime, 0);
  const insights = [];
  const add = (id, level, title, evidence, action) => insights.push({ id, level, title, evidence, action });
  const missingTargets = entries.filter((e) => e.target <= 0).length;
  if (missingTargets) add('missing-target', 'attention', 'Metas incompletas',
    `${missingTargets} de ${entries.length} registros não possuem meta positiva. O atingimento desses grupos fica sem base.`,
    'Confira o cadastro de metas e os lançamentos antes de avaliar o desempenho.');
  const below = cells.filter((c) => c.attainment != null && c.attainment < 100).sort((a, b) => a.attainment - b.attainment);
  if (below.length) {
    const cell = below[0];
    add('target-gap', 'attention', `${cell.cell}: menor atingimento`,
      `${formatMetric(cell.attainment)}% da meta; saldo de ${formatMetric(cell.gap)} ${cell.unitLabel}. ${below.length} grupo(s) de célula/unidade abaixo da meta no recorte.`,
      'Confira horas lançadas, paradas e abastecimento nesta célula. Um período em andamento ainda pode recuperar o saldo.');
  } else if (cells.length && !missingTargets) add('target-met', 'positive', 'Metas do recorte atingidas',
    `Os ${cells.length} grupo(s) de célula/unidade atingiram a meta registrada.`,
    'Confirme o fechamento das horas e acompanhe a qualidade para sustentar o resultado.');
  if (downtime > 0) {
    const cell = [...cells].sort((a, b) => b.downtime - a.downtime)[0];
    add('downtime', 'attention', `Paradas concentradas em ${cell.cell}`,
      `${formatMetric(cell.downtime)} min, equivalentes a ${formatMetric(ratio(cell.downtime, downtime))}% dos ${formatMetric(downtime)} min registrados.`,
      'Consulte os motivos das paradas e priorize a ocorrência mais recorrente; a duração isolada não determina a causa.');
  }
  const quality = cells.filter((c) => c.scrap > 0).sort((a, b) => b.scrapRate - a.scrapRate)[0];
  if (quality) add('scrap', 'attention', `Refugo em ${quality.cell}`,
    `${formatMetric(quality.scrapRate)}% de refugo: ${formatMetric(quality.scrap)} sobre ${formatMetric(quality.produced + quality.scrap)} ${quality.unitLabel} (produzido + refugo).`,
    'Verifique os códigos de falha e o retrabalho antes de escolher uma ação corretiva.');
  units.forEach((unit) => {
    const prev = previousUnits.find((p) => p.key === unit.key);
    if (!prev || prev.produced <= 0) return;
    const delta = (unit.produced - prev.produced) / prev.produced * 100;
    add(`comparison-${unit.key}`, 'info', `Volume em ${unit.unitLabel}: ${delta >= 0 ? '+' : ''}${formatMetric(delta)}%`,
      `${formatMetric(unit.produced)} no período atual e ${formatMetric(prev.produced)} no anterior.`,
      'Compare também dias trabalhados, mix e horas lançadas. Variação de produção não comprova mudança de demanda.');
  });
  if (entries.length && !previous.length) add('no-comparison', 'info', 'Sem histórico comparativo neste recorte',
    'Não há registros válidos do período anterior carregados para esta análise.',
    'Selecione um intervalo com histórico para avaliar a evolução.');
  const methodology = [
    'Fonte: lançamentos válidos de produção; registros estornados são excluídos dos totais.',
    'Volumes separados por unidade. Passagens da mesma peça por células diferentes não representam peças únicas finalizadas.',
    'Atingimento = produzido / meta. Sem meta positiva em todos os registros do grupo: sem base. Este indicador não é OEE.',
    'Refugo = refugo / (produzido + refugo), conforme a regra atual do sistema. Paradas = soma dos minutos registrados; equipamentos podem parar simultaneamente.',
    'As observações descrevem o recorte; as ações sugeridas são verificações, não diagnósticos confirmados nem previsão de demanda.',
  ];
  return { entries, units, previousUnits, cells, downtime, insights: insights.slice(0, 8), methodology,
    excludedCount: source.length - entries.length, missingTargets, recordCount: entries.length };
}

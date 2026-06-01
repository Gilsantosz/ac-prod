import { efficiency, scrapRate } from '@/lib/productionMetrics';

export const METRIC_LABELS = {
  efficiency: 'Eficiência (%)',
  scrapRate: 'Refugo (%)',
  downtime: 'Parada (min)',
  produced: 'Produzido (un)',
};

export const OPERATOR_LABELS = {
  lt: 'menor que',
  lte: 'menor ou igual a',
  gt: 'maior que',
  gte: 'maior ou igual a',
};

export const ACTION_LABELS = {
  alert: 'Emitir alerta',
  log_occurrence: 'Registrar ocorrência',
};

// Extrai o valor da métrica de uma entrada de produção
export function metricValue(entry, metric) {
  const produced = Number(entry.produced) || 0;
  const target = Number(entry.target) || 0;
  const scrap = Number(entry.scrap) || 0;
  switch (metric) {
    case 'efficiency': return efficiency(produced, target);
    case 'scrapRate': return scrapRate(scrap, produced);
    case 'downtime': return Number(entry.downtime) || 0;
    case 'produced': return produced;
    default: return 0;
  }
}

function compare(value, operator, threshold) {
  switch (operator) {
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    default: return false;
  }
}

// Verifica se uma regra é atendida por uma entrada
export function ruleMatches(rule, entry) {
  if (!rule.active) return false;
  if (rule.cell && rule.cell !== entry.cell) return false;
  // métrica de eficiência só faz sentido com meta definida
  if (rule.metric === 'efficiency' && !(Number(entry.target) > 0)) return false;
  const value = metricValue(entry, rule.metric);
  return compare(value, rule.operator, Number(rule.threshold));
}

// Retorna todas as regras disparadas por uma entrada, com o valor obtido
export function evaluateEntry(rules, entry) {
  return rules
    .filter((r) => ruleMatches(r, entry))
    .map((rule) => ({ rule, value: metricValue(entry, rule.metric), entry }));
}

export function describeRule(rule) {
  return `${METRIC_LABELS[rule.metric]} ${OPERATOR_LABELS[rule.operator]} ${rule.threshold}`;
}
export const CHART_AXIS_TICK = {
  fontSize: 11,
  fill: 'hsl(var(--muted-foreground))',
};

export const CHART_GRID_PROPS = {
  stroke: 'hsl(var(--chart-grid))',
  strokeDasharray: '4 7',
  strokeWidth: 1,
  strokeOpacity: 0.7,
};

export const CHART_TOOLTIP_CURSOR = {
  fill: 'hsl(var(--muted) / 0.32)',
  stroke: 'hsl(var(--border) / 0.45)',
  strokeWidth: 1,
};

export function chartAnimation(reduceMotion = false, delay = 0) {
  return {
    isAnimationActive: !reduceMotion,
    animationBegin: delay,
    animationDuration: reduceMotion ? 0 : 950,
    animationEasing: 'ease-out',
  };
}

export function getNiceAxisMax(values = [], minimum = 12) {
  const largest = Math.max(minimum, ...values.map(Number).filter(Number.isFinite));
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(largest)) - 1);
  const step = Math.max(2, magnitude * 2);
  return Math.ceil(largest / step) * step;
}

export function formatChartNumber(value, maximumFractionDigits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';
  return numericValue.toLocaleString('pt-BR', { maximumFractionDigits });
}

export function safeChartId(value) {
  return String(value || 'chart').replace(/[^a-zA-Z0-9_-]/g, '');
}

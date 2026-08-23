const DEFAULT_SERIES_COLORS = ['#00522d', '#d6a900', '#2563eb', '#7c3aed', '#dc2626'];

function roundedMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export async function renderReportChartPng(chart, { width = 1400, height = 620 } = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  if (!context) return null;

  canvas.width = width;
  canvas.height = height;
  const categories = chart?.categories || [];
  const series = (chart?.series || []).filter((item) => Array.isArray(item.values));
  if (!categories.length || !series.length) return null;

  const values = series.flatMap((item) => item.values).map(Number).filter(Number.isFinite);
  const yMax = roundedMax(Math.max(0, ...values));
  const margin = { top: 95, right: 55, bottom: 100, left: 105 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xFor = (index) => margin.left + (categories.length === 1 ? plotWidth / 2 : (index / (categories.length - 1)) * plotWidth);
  const yFor = (value) => margin.top + plotHeight - ((Number(value) || 0) / yMax) * plotHeight;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#0f172a';
  context.font = '700 32px Arial, sans-serif';
  context.fillText(String(chart.title || 'Análise'), margin.left, 48);

  context.font = '20px Arial, sans-serif';
  let legendX = margin.left;
  series.forEach((item, index) => {
    context.fillStyle = item.color || DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length];
    context.fillRect(legendX, 62, 28, 5);
    context.fillStyle = '#334155';
    context.fillText(String(item.name || `Série ${index + 1}`), legendX + 38, 70);
    legendX += context.measureText(String(item.name || '')).width + 92;
  });

  context.font = '17px Arial, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let step = 0; step <= 5; step += 1) {
    const value = (yMax / 5) * step;
    const y = yFor(value);
    context.strokeStyle = '#e2e8f0';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillStyle = '#64748b';
    context.fillText(`${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${chart.unit || ''}`, margin.left - 14, y);
  }

  const labelStep = Math.max(1, Math.ceil(categories.length / 10));
  context.textAlign = 'center';
  context.textBaseline = 'top';
  categories.forEach((category, index) => {
    if (index % labelStep !== 0 && index !== categories.length - 1) return;
    context.fillStyle = '#64748b';
    context.fillText(String(category), xFor(index), margin.top + plotHeight + 18);
  });

  series.forEach((item, seriesIndex) => {
    context.strokeStyle = item.color || DEFAULT_SERIES_COLORS[seriesIndex % DEFAULT_SERIES_COLORS.length];
    context.lineWidth = 5;
    context.lineJoin = 'round';
    context.beginPath();
    item.values.forEach((value, index) => {
      const x = xFor(index);
      const y = yFor(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });

  return canvas.toDataURL('image/png', 1);
}

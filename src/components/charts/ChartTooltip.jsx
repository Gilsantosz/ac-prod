import { formatChartNumber } from './chartTheme';

const FALLBACK_COLORS = {
  Meta: '#94a3b8',
  Produzido: '#10b981',
  Atingimento: '#0ea5e9',
  Eficiência: '#10b981',
  Refugo: '#ef4444',
  Reprovadas: '#ef4444',
  Defeitos: '#8b5cf6',
};

function resolveColor(item) {
  const explicit = item?.stroke || item?.color;
  if (explicit && !String(explicit).startsWith('url(')) return explicit;
  return FALLBACK_COLORS[item?.name] || '#10b981';
}

export default function ChartTooltip({
  active,
  payload,
  label,
  unit = '',
  labelFormatter,
  valueFormatter,
}) {
  if (!active || !payload?.length) return null;

  const visiblePayload = payload.filter((item) => item?.value !== null && item?.value !== undefined);
  if (!visiblePayload.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(label, visiblePayload) : label;

  return (
    <div className="chart-tooltip" role="status" aria-live="polite">
      {formattedLabel !== undefined && formattedLabel !== null && (
        <p className="chart-tooltip__label">{formattedLabel}</p>
      )}
      <div className="chart-tooltip__items">
        {visiblePayload.map((item, index) => {
          const name = item.name || item.dataKey || `Série ${index + 1}`;
          const formattedValue = valueFormatter
            ? valueFormatter(item.value, name, item, visiblePayload)
            : `${formatChartNumber(item.value)}${unit ? ` ${unit}` : ''}`;

          return (
            <div className="chart-tooltip__row" key={`${name}-${index}`}>
              <span className="chart-tooltip__swatch" style={{ background: resolveColor(item) }} aria-hidden="true" />
              <span className="chart-tooltip__name">{name}</span>
              <strong className="chart-tooltip__value">{formattedValue}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

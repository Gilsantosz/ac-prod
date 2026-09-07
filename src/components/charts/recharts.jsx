import React, { Children, Fragment, cloneElement, forwardRef, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Recharts from 'recharts';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Maximize2, MoreHorizontal, Table2, X } from 'lucide-react';
import { dataPage, formatChartValue, readChartValue, seriesPaint } from './chartModel.mjs';
import './charts.css';

// IMPORTANT: Bar/Line/Area/axes must remain the ORIGINAL Recharts 2 components.
// Wrapping these primitives breaks its direct-child discovery and SVG paint servers.
export * from 'recharts';
const nameOf = (element) => element?.type?.displayName || element?.type?.name || '';
const chartNames = new Set(['BarChart', 'LineChart', 'AreaChart', 'ComposedChart', 'PieChart', 'RadarChart', 'RadialBarChart', 'ScatterChart', 'Treemap']);
function flatChildren(children) {
  return Children.toArray(children).flatMap((child) => child?.type === Fragment ? flatChildren(child.props.children) : [child]);
}
export function describeChart(chart) {
  const children = flatChildren(chart.props.children);
  const series = children.filter((child) => isValidElement(child) && ['Bar', 'Line', 'Area', 'Pie', 'Radar', 'RadialBar', 'Scatter'].includes(nameOf(child)) && !child.props.hide);
  const ownData = series.filter((child) => Array.isArray(child.props.data));
  const rows = Array.isArray(chart.props.data) ? chart.props.data
    : ownData.length === 1 ? ownData[0].props.data : [];
  const dimension = children.find((child) => ['XAxis', 'YAxis', 'PolarAngleAxis'].includes(nameOf(child)) && child.props.dataKey != null && child.props.type !== 'number');
  const categoryKey = dimension?.props.dataKey ?? series.find((child) => child.props.nameKey)?.props.nameKey;
  const units = series.map((series) => series.props.unit || children.find((axis) => ['XAxis', 'YAxis'].includes(nameOf(axis)) && axis.props.unit != null && axis.props.type !== 'category' && (axis.props.yAxisId ?? 0) === (series.props.yAxisId ?? 0) && (axis.props.xAxisId ?? 0) === (series.props.xAxisId ?? 0))?.props.unit || '');
  return { children, series, rows, units, categoryKey, tooltip: children.find((child) => nameOf(child) === 'Tooltip') };
}
export function decorateChart(chart, id, onPointClick) {
  const { children } = describeChart(chart);
  const horizontal = chart.props.layout === 'vertical';
  const definitions = [];
  const styled = children.map((child, index) => {
    if (!isValidElement(child)) return child;
    const kind = nameOf(child);
    const props = child.props;
    if (['Bar', 'Line', 'Area'].includes(kind)) {
      const colors = seriesPaint(props, kind);
      const paintId = `${id}-${kind.toLowerCase()}-${index}`;
      if (colors) definitions.push(
        <linearGradient key={paintId} id={paintId} gradientUnits={kind === 'Line' ? 'userSpaceOnUse' : 'objectBoundingBox'} x1="0" y1="0" x2={kind === 'Line' || horizontal ? '100%' : '0%'} y2={kind === 'Line' || horizontal ? '0%' : '100%'}>
          <stop offset="0%" stopColor={colors[0]} stopOpacity={colors[0] === colors[1] ? 0.7 : 1} />
          <stop offset="100%" stopColor={colors[1]} />
        </linearGradient>
      );
      // CSS entry animations leave actual SVG geometry and live updates correct.
      // Do not modify domains, data, stackId, axes, custom shapes, Cell or null handling.
      return cloneElement(child, {
        ...(colors ? { [kind === 'Line' ? 'stroke' : 'fill']: `url(#${paintId})` } : {}),
        isAnimationActive: false,
        ...(kind === 'Line' ? { strokeWidth: Math.max(2.5, Number(props.strokeWidth) || 2.5) } : {}),
      });
    }
    if (kind === 'CartesianGrid') return cloneElement(child, {
      strokeDasharray: '3 5', stroke: 'var(--ac-chart-grid)', strokeWidth: 1,
      horizontal: props.horizontal ?? !horizontal, vertical: props.vertical ?? horizontal,
    });
    if (kind === 'Tooltip') return cloneElement(child, {
      contentStyle: { ...props.contentStyle, background: 'var(--ac-chart-tooltip)', border: '1px solid var(--ac-chart-border)', borderRadius: 14, boxShadow: '0 12px 32px rgb(15 23 42 / .12)', color: 'hsl(var(--foreground))' },
      itemStyle: { color: 'hsl(var(--foreground))', ...props.itemStyle },
      formatter: props.formatter || ((value, name) => [formatChartValue(value), name]),
    });
    if (kind === 'Legend') return cloneElement(child, {
      iconType: props.iconType || 'circle', iconSize: props.iconSize || 8,
      wrapperStyle: { fontSize: 12, ...props.wrapperStyle },
    });
    return child;
  });
  return cloneElement(chart, {
    accessibilityLayer: chart.props.accessibilityLayer ?? true,
    onClick: (state, event) => { chart.props.onClick?.(state, event); onPointClick?.(state); },
  }, ...styled, <defs key={`${id}-presentation-defs`}>{definitions}</defs>);
}

const IconButton = forwardRef(function IconButton({ label, children, ...props }, ref) {
  return <button ref={ref} type="button" className="ac-chart-button" title={label} aria-label={label} {...props}>{children}</button>;
});
function PointDetails({ point, tooltip, onClose }) {
  if (!point?.activePayload?.length) return null;
  return <aside className="ac-chart-point" aria-label="Detalhes do ponto selecionado" role="status">
    <div className="ac-chart-point-heading"><strong>{formatChartValue(point.activeLabel)}</strong><IconButton label="Fechar detalhes" onClick={onClose}><X size={14} /></IconButton></div>
    {point.activePayload.filter((entry) => entry.value != null && entry.type !== 'none').map((entry, index, all) => {
      const formatted = tooltip?.props.formatter?.(entry.value, entry.name, entry, index, all);
      const [value, label] = Array.isArray(formatted) ? formatted : [formatted ?? formatChartValue(entry.value), entry.name];
      return <div className="ac-chart-point-row" key={`${entry.dataKey}-${index}`}><span>{label}</span><strong>{value}{!formatted && entry.unit ? ` ${entry.unit}` : ''}</strong></div>;
    })}
  </aside>;
}
function DataTable({ model, page }) {
  const selected = dataPage(model.rows, page);
  return <div className="ac-chart-table-scroll" tabIndex={0} role="region" aria-label="Tabela dos valores do gráfico">
    <table className="ac-chart-table"><caption>Dados do mesmo recorte do gráfico · página {selected.page + 1} de {selected.pageCount}</caption>
      <thead><tr><th scope="col">Categoria</th>{model.series.map((series, index) => <th scope="col" key={index}>{series.props.name || String(series.props.dataKey)}{model.units[index] ? ` (${model.units[index]})` : ''}</th>)}</tr></thead>
      <tbody>{selected.rows.map((row, index) => <tr key={selected.page * 20 + index}>
        <th scope="row">{model.categoryKey == null ? selected.page * 20 + index + 1 : formatChartValue(readChartValue(row, model.categoryKey))}</th>
        {model.series.map((series, seriesIndex) => <td key={seriesIndex}>{formatChartValue(readChartValue(row, series.props.dataKey))}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

/** One presentation host, one SVG tree. No additional query, listener to Supabase or data copy. */
export const ResponsiveContainer = forwardRef(function GlassResponsiveContainer({ children, width = '100%', height = '100%', aspect, minWidth = 0, minHeight, maxHeight, style, className = '', chartTitle, ...props }, ref) {
  const id = `ac-chart-${useId().replace(/:/g, '')}`;
  const supported = isValidElement(children) && chartNames.has(nameOf(children));
  const model = useMemo(() => supported ? describeChart(children) : null, [children, supported]);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [table, setTable] = useState(false);
  const [page, setPage] = useState(0);
  const [motion, setMotion] = useState(true);
  const [point, setPoint] = useState(null);
  const host = useRef(null);
  const [title, setTitle] = useState(chartTitle || 'Gráfico');
  useEffect(() => {
    if (chartTitle) { setTitle(chartTitle); return; }
    const card = host.current?.closest('[data-slot="card"], article, .bg-card, .rounded-2xl');
    const heading = card?.querySelector('h2, h3, h4');
    if (heading?.textContent) setTitle(heading.textContent);
  }, [chartTitle]);
  useEffect(() => { setPage(0); setPoint(null); }, [model?.rows]);
  if (!supported) return <Recharts.ResponsiveContainer {...{ width, height, aspect, minWidth, minHeight, maxHeight, style, className, ...props }} ref={ref}>{children}</Recharts.ResponsiveContainer>;
  const selected = dataPage(model.rows, page);
  const hasTable = model.rows.length > 0 && model.series.length > 0;
  const showPage = (delta) => { setTable(true); setPage(Math.min(selected.pageCount - 1, Math.max(0, selected.page + delta))); };
  const decorated = decorateChart(children, id, (state) => { if (state?.activePayload?.length) setPoint({ activeLabel: state.activeLabel, activePayload: state.activePayload }); });
  const hostStyle = { ...style, width, height: aspect ? 'auto' : height, aspectRatio: aspect || undefined, minWidth, minHeight, maxHeight };
  const toolbar = <div className="ac-chart-toolbar" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} role="group" aria-label={`Controles: ${title}`}>
    <span className="ac-chart-toolbar-hint">{table ? `${selected.page + 1}/${selected.pageCount} · dados` : 'Explorar dados'}</span>
    <IconButton label="Página anterior dos dados" disabled={selected.page === 0 || !hasTable} onClick={() => showPage(-1)}><ChevronLeft size={16} /></IconButton>
    <IconButton label="Próxima página dos dados" disabled={selected.page + 1 >= selected.pageCount || !hasTable} onClick={() => showPage(1)}><ChevronRight size={16} /></IconButton>
    <IconButton label={expanded ? 'Restaurar tamanho do gráfico' : 'Expandir gráfico'} onClick={() => setExpanded(!expanded)}><Maximize2 size={15} /></IconButton>
    <IconButton label={hidden ? 'Mostrar gráfico' : 'Ocultar gráfico'} aria-pressed={hidden} onClick={() => { setHidden(!hidden); setPoint(null); }}>{hidden ? <Eye size={16} /> : <EyeOff size={16} />}</IconButton>
    <details className="ac-chart-options"><summary className="ac-chart-button" title="Opções do gráfico" aria-label="Opções do gráfico"><MoreHorizontal size={17} /></summary>
      <div className="ac-chart-menu"><button type="button" disabled={!hasTable} onClick={(event) => { setTable(!table); event.currentTarget.closest('details').open = false; }}><Table2 size={15} />{table ? 'Mostrar gráfico' : 'Ver tabela de dados'}</button>
        <button type="button" onClick={(event) => { setMotion(!motion); event.currentTarget.closest('details').open = false; }}>{motion ? 'Desativar animações' : 'Ativar animações'}</button>
        <p>As setas paginam a tabela; o gráfico mantém todo o recorte e sua escala.</p>
      </div>
    </details>
  </div>;
  const body = <div className={`ac-chart-body ${children.props.layout === 'vertical' ? 'ac-chart-horizontal' : ''}`} data-motion={motion && model.rows.length <= 300 ? 'on' : 'off'}>
    {hidden ? <div className="ac-chart-empty"><button type="button" onClick={() => setHidden(false)}>Mostrar gráfico oculto</button></div>
      : table ? <DataTable model={model} page={selected.page} />
      : <><Recharts.ResponsiveContainer {...props} width="100%" height="100%" minWidth={0} ref={ref}>{decorated}</Recharts.ResponsiveContainer>
        <PointDetails point={point} tooltip={model.tooltip} onClose={() => setPoint(null)} /></>}
  </div>;
  return <Dialog.Root open={expanded} onOpenChange={setExpanded}>
    <div ref={host} className={`ac-chart-host ${className}`} style={hostStyle} aria-label={title}>
      {expanded ? <div className="ac-chart-empty">Gráfico expandido</div> : <>{toolbar}{body}</>}
    </div>
    {expanded && <Dialog.Portal><Dialog.Overlay className="ac-chart-overlay" /><Dialog.Content className="ac-chart-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); host.current?.querySelector('button[aria-label="Expandir gráfico"]')?.focus(); }}>
      <div className="ac-chart-dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><IconButton label="Fechar gráfico expandido"><X size={20} /></IconButton></Dialog.Close></div>
      <Dialog.Description className="ac-chart-description">Mesmo recorte, unidades e valores da tela de origem. Esc fecha esta janela.</Dialog.Description>
      {toolbar}{body}
    </Dialog.Content></Dialog.Portal>}
  </Dialog.Root>;
});

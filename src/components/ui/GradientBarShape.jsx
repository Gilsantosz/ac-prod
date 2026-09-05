import { useId } from 'react';
import { Rectangle } from 'recharts';

// Keeps each chart's semantic color (including Cell overrides) and rounds the bar edges.
export default function GradientBarShape({ fill = 'hsl(var(--chart-2))', x, y, width, height, radius = 4, horizontal = false }) {
  const id = `bar-${useId().replace(/:/g, '')}`;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (String(fill).startsWith('url(')) return <Rectangle x={x} y={y} width={width} height={height} radius={radius} fill={fill} />;
  return <g><defs><linearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}><stop offset="0%" stopColor={fill} stopOpacity={0.55} /><stop offset="100%" stopColor={fill} /></linearGradient></defs><Rectangle x={x} y={y} width={width} height={height} radius={radius} fill={`url(#${id})`} /></g>;
}

// Recharts 2 filters direct chart children. Mount these inside a native <defs>
// child of the chart so React can render the gradient definitions normally.
export default function BarGradientStops({ id, horizontal = false }) {
  return <>{[['produced', '#34d399', '#15803d'], ['target', '#cbd5e1', '#64748b'], ['warning', '#fbbf24', '#d97706']].map(([key, start, end]) =>
    <linearGradient key={key} id={`${id}-${key}`} x1="0%" y1="0%" x2={horizontal ? '100%' : '0%'} y2={horizontal ? '0%' : '100%'}><stop offset="0%" stopColor={start} /><stop offset="100%" stopColor={end} /></linearGradient>)}</>;
}

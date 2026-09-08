// Recharts 2 filters direct chart children. Mount these inside a native <defs>
// child of the chart so React can render the gradient definitions normally.
export default function BarGradientStops({ id, horizontal = false }) {
  const gradients = [
    ['produced', '#34d399', '#059669', 1, 1],
    ['target', '#e2e8f0', '#94a3b8', 1, 1],
    ['warning', '#fcd34d', '#d97706', 1, 1],
    ['blue', '#38bdf8', '#2563eb', 1, 1],
    ['area', '#34d399', '#059669', 0.35, 0.02],
    ['area-blue', '#38bdf8', '#2563eb', 0.35, 0.02],
  ];

  return (
    <>
      {gradients.map(([key, start, end, startOp = 1, endOp = 1]) => (
        <linearGradient
          key={key}
          id={`${id}-${key}`}
          x1="0%"
          y1="0%"
          x2={horizontal ? '100%' : '0%'}
          y2={horizontal ? '0%' : '100%'}
        >
          <stop offset="0%" stopColor={start} stopOpacity={startOp} />
          <stop offset="100%" stopColor={end} stopOpacity={endOp} />
        </linearGradient>
      ))}
    </>
  );
}

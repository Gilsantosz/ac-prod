import { useState, useRef, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Dark mode hook ────────────────────────────────────────────────── */
function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/* ─── Gradientes por métrica ────────────────────────────────────────── */
const METRIC_GRADIENTS = {
  availability: {
    id: 'availGrad',
    colors: ['#4ade80', '#22d3ee', '#0891b2'],
    label: 'Disponibilidade',
    dot: '#0891b2',
  },
  performance: {
    id: 'perfGrad',
    colors: ['#fde68a', '#fbbf24', '#f97316'],
    label: 'Performance',
    dot: '#f97316',
  },
  quality: {
    id: 'qualGrad',
    colors: ['#4ade80', '#16a34a', '#166534'],
    label: 'Qualidade',
    dot: '#16a34a',
  },
};

const METRICS = ['availability', 'performance', 'quality'];
const SCALE = ['300', '450', '580', '700', '850'];
const BAR_H = 11;
const BAR_GAP = 5;
const GROUP_GAP = 28;
const LABEL_W = 72;

/* ─── Wave Bar ─────────────────────────────────────────────────────── */
function WaveBar({ pct, metricKey, barH, totalW, delay = 0, dark }) {
  const meta = METRIC_GRADIENTS[metricKey];
  const uid = `${meta.id}_${Math.round(delay * 1000)}`;
  const gradId = `${uid}_g`;
  const waveId = `${uid}_w`;
  const clipId = `${uid}_c`;
  const w = Math.max(0, (pct / 100) * totalW);
  const rx = barH / 2;
  const trackColor = dark ? 'rgba(255,255,255,0.06)' : '#f1f5f9';
  const waveStroke = dark ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.30)';

  return (
    <svg width={totalW} height={barH} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          {meta.colors.map((c, i) => (
            <stop key={i} offset={`${(i / (meta.colors.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
        <pattern id={waveId} x="0" y="0" width="14" height={barH} patternUnits="userSpaceOnUse">
          <path
            d={`M0 ${barH * 0.5} Q3.5 ${barH * 0.1} 7 ${barH * 0.5} Q10.5 ${barH * 0.9} 14 ${barH * 0.5}`}
            fill="none" stroke={waveStroke} strokeWidth="1"
          />
        </pattern>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={w} height={barH} rx={rx} />
        </clipPath>
      </defs>

      {/* Track */}
      <rect x={0} y={0} width={totalW} height={barH} rx={rx} fill={trackColor} />

      {/* Bar */}
      {w > 0 && (
        <motion.g
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay }}
          style={{ transformOrigin: '0 50%' }}
        >
          <rect x={0} y={0} width={w} height={barH} rx={rx} fill={`url(#${gradId})`} />
          <rect x={0} y={0} width={w} height={barH} rx={rx}
            fill={`url(#${waveId})`} clipPath={`url(#${clipId})`} />
        </motion.g>
      )}

      {/* End cap */}
      {w > barH && (
        <circle cx={w - rx} cy={barH / 2} r={rx - 1}
          fill={meta.colors[meta.colors.length - 1]} opacity={0.9} />
      )}
    </svg>
  );
}

/* ─── Tooltip ───────────────────────────────────────────────────────── */
function CellTooltip({ row, x, y, dark }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -4 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute',
        left: x + 14,
        top: y - 24,
        background: dark ? 'hsl(240 10% 8%)' : '#fff',
        borderRadius: 12,
        boxShadow: dark
          ? '0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.05) inset'
          : '0 4px 20px rgba(0,0,0,0.13)',
        padding: '10px 14px',
        pointerEvents: 'none',
        zIndex: 20,
        minWidth: 130,
        border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e2e8f0',
      }}
    >
      <p style={{
        fontSize: 11, fontWeight: 700, marginBottom: 6,
        color: dark ? '#e2e8f0' : '#334155',
      }}>
        {row.cell}
      </p>
      {METRICS.map((m) => {
        const meta = METRIC_GRADIENTS[m];
        return (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: meta.colors[1], flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: meta.dot }}>
              {(row[m] ?? 0).toFixed(1)}%
            </span>
          </div>
        );
      })}
    </motion.div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────── */
export default function OeeByCellChart({ rows = [] }) {
  const dark = useDark();
  const [hoveredCell, setHoveredCell] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [barWidth, setBarWidth] = useState(520);
  const barsRef = useRef(null);

  useEffect(() => {
    if (!barsRef.current) return;
    const obs = new ResizeObserver(([entry]) =>
      setBarWidth(Math.floor(entry.contentRect.width) - 4)
    );
    obs.observe(barsRef.current);
    return () => obs.disconnect();
  }, []);

  if (!rows.length) return null;

  const rowH = BAR_H * 3 + BAR_GAP * 2 + GROUP_GAP;

  // Cores por tema
  const cardBg = dark ? 'hsl(240 10% 6%)' : '#ffffff';
  const cardShadow = dark
    ? '0 2px 20px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.04) inset'
    : '0 2px 16px rgba(0,0,0,0.07)';
  const titleColor = dark ? '#e2e8f0' : '#1e293b';
  const iconColor = dark ? '#475569' : '#94a3b8';
  const labelColor = dark ? '#64748b' : '#475569';
  const scaleColor = dark ? '#475569' : '#94a3b8';
  const legendColor = dark ? '#94a3b8' : '#475569';
  const cardBorder = dark ? '1px solid rgba(255,255,255,0.06)' : 'none';

  return (
    <div style={{
      background: cardBg,
      borderRadius: 20,
      boxShadow: cardShadow,
      padding: '20px 24px 20px',
      border: cardBorder,
      transition: 'background 0.3s, box-shadow 0.3s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <BarChart3 size={16} color={iconColor} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: titleColor, margin: 0 }}>
          Componentes do OEE por Célula
        </h3>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 0 }}>

          {/* Y labels */}
          <div style={{ width: LABEL_W, flexShrink: 0, paddingTop: 24 }}>
            {rows.map((row) => (
              <div
                key={row.cell}
                style={{
                  height: rowH,
                  display: 'flex', alignItems: 'center',
                  fontSize: 12, fontWeight: 600, color: labelColor,
                }}
              >
                {row.cell}
              </div>
            ))}
          </div>

          {/* Bars area */}
          <div ref={barsRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>

            {/* Scale top */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, paddingRight: 2 }}>
              {SCALE.map((s) => (
                <span key={s} style={{ fontSize: 10, color: scaleColor, fontWeight: 500 }}>{s}</span>
              ))}
            </div>

            {/* Grid lines vertical (subtle) */}
            <div style={{ position: 'relative' }}>
              {[0, 25, 50, 75, 100].map((pct) => (
                <div key={pct} style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  pointerEvents: 'none',
                }} />
              ))}

              {/* Bar rows */}
              {rows.map((row, ri) => (
                <div
                  key={row.cell}
                  style={{ height: rowH, paddingTop: 4, position: 'relative', cursor: 'pointer' }}
                  onMouseEnter={() => {
                    setHoveredCell(row.cell);
                    setTooltipPos({ x: barWidth * 0.52, y: ri * rowH + rowH / 2 });
                  }}
                  onMouseLeave={() => setHoveredCell(null)}
                >
                  {METRICS.map((m, mi) => {
                    const pct = Math.max(0, Math.min(100, row[m] ?? 0));
                    return (
                      <div key={m} style={{ marginBottom: mi < 2 ? BAR_GAP : 0 }}>
                        <WaveBar
                          pct={pct}
                          metricKey={m}
                          barH={BAR_H}
                          totalW={barWidth}
                          delay={ri * 0.06 + mi * 0.02}
                          dark={dark}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* X-axis labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: 2, marginTop: 4 }}>
              {[0, 25, 50, 75, 100].map((v) => (
                <span key={v} style={{ fontSize: 10, color: scaleColor, fontWeight: 500 }}>{v}%</span>
              ))}
            </div>

            {/* Tooltip */}
            <AnimatePresence>
              {hoveredCell && (() => {
                const row = rows.find((r) => r.cell === hoveredCell);
                if (!row) return null;
                return (
                  <CellTooltip
                    key={hoveredCell}
                    row={row}
                    x={tooltipPos.x}
                    y={tooltipPos.y}
                    dark={dark}
                  />
                );
              })()}
            </AnimatePresence>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          gap: 24, marginTop: 14, flexWrap: 'wrap',
        }}>
          {METRICS.map((m) => {
            const meta = METRIC_GRADIENTS[m];
            return (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: `linear-gradient(90deg, ${meta.colors[0]}, ${meta.colors[2]})`,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, color: legendColor, fontWeight: 600 }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/* ─── Dark mode hook ─────────────────────────────────────────────────── */
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

/* ─── Paleta por índice ─────────────────────────────────────────────── */
const CONFIGS = [
  {
    colors: ['#dc2626', '#ef4444', '#f97316', '#fb923c', '#fbbf24'],
    trackLight: '#fef2f2',
    trackDark: 'rgba(220,38,38,0.12)',
    statusText: '#dc2626',
    statusBgLight: 'rgba(220,38,38,0.10)',
    statusBgDark: 'rgba(220,38,38,0.22)',
  },
  {
    colors: ['#4ade80', '#22d3ee', '#0891b2', '#0e7490', '#155e75'],
    trackLight: '#f0fdf4',
    trackDark: 'rgba(8,145,178,0.12)',
    statusText: '#0891b2',
    statusBgLight: 'rgba(8,145,178,0.10)',
    statusBgDark: 'rgba(8,145,178,0.22)',
  },
  {
    colors: ['#fde68a', '#fbbf24', '#f59e0b', '#f97316', '#ea580c'],
    trackLight: '#fffbeb',
    trackDark: 'rgba(249,115,22,0.12)',
    statusText: '#f97316',
    statusBgLight: 'rgba(249,115,22,0.10)',
    statusBgDark: 'rgba(249,115,22,0.22)',
  },
  {
    colors: ['#4ade80', '#16a34a', '#047857', '#1d4ed8', '#1e40af'],
    trackLight: '#f0fdf4',
    trackDark: 'rgba(4,120,87,0.12)',
    statusText: '#047857',
    statusBgLight: 'rgba(4,120,87,0.10)',
    statusBgDark: 'rgba(4,120,87,0.22)',
  },
];

const STATUS_LABEL = (v) =>
  v >= 85 ? 'ÓTIMO' : v >= 60 ? 'ATENÇÃO' : 'CRÍTICO';

/* ─── Geometria do arco ─────────────────────────────────────────────── */
// ViewBox: 240 × 195  →  centro em (120, 115), raio 82
// Arco de 210° a 330° (330° total sweep), sentido horário
const VW = 240, VH = 195;
const CX = 120, CY = 115, R = 82, SW = 16;
const ARC_START = 210, ARC_TOTAL = 300;
const SEGS = 30;

const SCALE_MARKS = [
  { label: '300', angle: 210 },
  { label: '450', angle: 247.5 },
  { label: '580', angle: 270 },
  { label: '700', angle: 292.5 },
  { label: '850', angle: 330 },
];

function polarToXY(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const s = polarToXY(cx, cy, r, startAngle);
  const e = polarToXY(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/* ─── Component ─────────────────────────────────────────────────────── */
export default function OeeGauge({ value = 0, title, subtitle, index = 0 }) {
  const dark = useDark();
  const v = Math.max(0, Math.min(100, value));
  const cfg = CONFIGS[index] ?? CONFIGS[0];
  const statusLabel = STATUS_LABEL(v);
  const valueAngle = ARC_START + (v / 100) * ARC_TOTAL;
  const segStep = (v / 100) * ARC_TOTAL / SEGS;

  const gradId = `gg_grad_${index}`;
  const mainColor = cfg.colors[2];

  /* ── Cores por tema ── */
  const cardBg       = dark ? 'hsl(240 10% 6%)' : '#ffffff';
  const cardBorder   = dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.05)';
  const cardShadow   = dark
    ? '0 4px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset'
    : '0 2px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)';
  const titleColor    = dark ? '#cbd5e1' : '#475569';
  const trackColor    = dark ? cfg.trackDark : cfg.trackLight;
  const scaleColor    = dark ? '#64748b' : '#94a3b8';
  const subtitleColor = dark ? '#64748b' : '#94a3b8';
  const statusBg      = dark ? cfg.statusBgDark : cfg.statusBgLight;
  const dotBorder     = dark ? '#1e293b' : '#fff';
  const waveColor     = dark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.26)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
      style={{
        background: cardBg,
        borderRadius: 22,
        boxShadow: cardShadow,
        border: cardBorder,
        padding: '16px 16px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 0,
        flex: 1,
        transition: 'background 0.3s, box-shadow 0.3s',
      }}
    >
      {/* Título */}
      <p style={{
        fontSize: 13, fontWeight: 700, color: titleColor,
        marginBottom: 0, letterSpacing: 0.2, whiteSpace: 'nowrap',
      }}>
        {title}
      </p>

      {/* SVG — viewBox espaçoso para não cortar os labels laterais */}
      <div style={{ width: '100%', maxWidth: 220 }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              {cfg.colors.map((c, i) => (
                <stop
                  key={i}
                  offset={`${(i / (cfg.colors.length - 1)) * 100}%`}
                  stopColor={c}
                />
              ))}
            </linearGradient>
          </defs>

          {/* Track */}
          <path
            d={arcPath(CX, CY, R, ARC_START, ARC_START + ARC_TOTAL)}
            fill="none"
            stroke={trackColor}
            strokeWidth={SW}
            strokeLinecap="round"
          />

          {/* Arco preenchido */}
          {v > 0 && (
            <motion.path
              d={arcPath(CX, CY, R, ARC_START, ARC_START + ARC_TOTAL)}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={SW}
              strokeLinecap="round"
              strokeDasharray={`${(v / 100) * (Math.PI * R * ARC_TOTAL / 180)} ${Math.PI * R * 2}`}
              initial={{ strokeDashoffset: Math.PI * R * ARC_TOTAL / 180 }}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: 1.1, ease: 'easeOut', delay: index * 0.08 }}
            />
          )}

          {/* Wave texture — segmentos com gap */}
          {v > 0 && Array.from({ length: SEGS }).map((_, i) => {
            const start = ARC_START + i * segStep;
            const end = start + segStep - 1.5;
            if (end <= start) return null;
            return (
              <path
                key={i}
                d={arcPath(CX, CY, R, start, end)}
                fill="none"
                stroke={waveColor}
                strokeWidth={SW - 4}
                strokeLinecap="butt"
              />
            );
          })}

          {/* Marcações de escala — deslocadas para fora do arco */}
          {SCALE_MARKS.map(({ label, angle }) => {
            const pos = polarToXY(CX, CY, R + 24, angle);
            return (
              <text
                key={label}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill={scaleColor}
                fontWeight="500"
                fontFamily="inherit"
              >
                {label}
              </text>
            );
          })}

          {/* Dot indicador no fim do arco */}
          {v > 0 && (() => {
            const pt = polarToXY(CX, CY, R, valueAngle);
            return (
              <circle
                cx={pt.x} cy={pt.y} r={6}
                fill={mainColor}
                stroke={dotBorder}
                strokeWidth={2.5}
              />
            );
          })()}

          {/* Texto central — percentual + badge */}
          <text
            x={CX} y={CY - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="30"
            fontWeight="800"
            fill={mainColor}
            fontFamily="'Outfit', system-ui, sans-serif"
            letterSpacing="-1"
          >
            {value.toFixed(1)}
            <tspan fontSize="16" fontWeight="600">%</tspan>
          </text>

          {/* Badge de status */}
          {(() => {
            const badgeW = statusLabel === 'ATENÇÃO' ? 62 : statusLabel === 'CRÍTICO' ? 58 : 50;
            const badgeH = 18;
            const badgeX = CX - badgeW / 2;
            const badgeY = CY + 24;
            return (
              <g>
                <rect
                  x={badgeX} y={badgeY}
                  width={badgeW} height={badgeH}
                  rx={badgeH / 2}
                  fill={statusBg}
                />
                <text
                  x={CX} y={badgeY + badgeH / 2 + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill={cfg.statusText}
                  letterSpacing="1"
                  fontFamily="'Outfit', system-ui, sans-serif"
                >
                  {statusLabel}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* Subtítulo fora do SVG — nunca será cortado */}
      {subtitle && (
        <p style={{
          fontSize: 11,
          color: subtitleColor,
          textAlign: 'center',
          marginTop: 4,
          lineHeight: 1.4,
          padding: '0 4px',
          wordBreak: 'break-word',
          maxWidth: '100%',
        }}>
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}
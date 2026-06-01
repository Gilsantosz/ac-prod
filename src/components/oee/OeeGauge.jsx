import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';

const palette = (v) =>
  v >= 85
    ? { ring: '#16a34a', soft: 'rgba(22,163,74,0.12)', label: 'Ótimo' }
    : v >= 60
    ? { ring: '#f59e0b', soft: 'rgba(245,158,11,0.12)', label: 'Atenção' }
    : { ring: '#dc2626', soft: 'rgba(220,38,38,0.12)', label: 'Crítico' };

export default function OeeGauge({ value = 0, title, subtitle, index = 0 }) {
  const v = Math.max(0, Math.min(100, value));
  const { ring, soft, label } = palette(v);

  // Arco semicircular: 180° (de baixo-esquerda a baixo-direita)
  const r = 70;
  const cx = 90;
  const cy = 90;
  const circ = Math.PI * r; // metade da circunferência
  const dash = (v / 100) * circ;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Card className="p-5 border-border/60 flex flex-col items-center bg-card hover:shadow-md transition-shadow">
        <p className="font-semibold text-sm text-muted-foreground">{title}</p>
        <div className="relative" style={{ width: 180, height: 110 }}>
          <svg width="180" height="110" viewBox="0 0 180 110">
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke="hsl(var(--secondary))"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <motion.path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke={ring}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={circ}
              initial={{ strokeDashoffset: circ }}
              animate={{ strokeDashoffset: circ - dash }}
              transition={{ duration: 0.9, ease: 'easeOut', delay: index * 0.06 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
            <span className="text-3xl font-bold leading-none" style={{ color: ring }}>
              {value}
              <span className="text-lg">%</span>
            </span>
            <span
              className="mt-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{ color: ring, background: soft }}
            >
              {label}
            </span>
          </div>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground text-center mt-2">{subtitle}</p>}
      </Card>
    </motion.div>
  );
}
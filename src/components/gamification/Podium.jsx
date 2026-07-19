import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function PodiumBadge({ position }) {
  const configs = {
    1: { bg: 'bg-amber-100 text-amber-600 border-amber-300', ring: 'ring-amber-500/20', label: '1' },
    2: { bg: 'bg-slate-100 text-slate-600 border-slate-300', ring: 'ring-slate-400/20', label: '2' },
    3: { bg: 'bg-orange-100 text-orange-700 border-orange-200', ring: 'ring-orange-500/20', label: '3' },
  };
  const config = configs[position];

  return (
    <div className={`relative flex items-center justify-center w-14 h-14 rounded-full border-2 ${config.bg} shadow-md ring-4 ${config.ring} mx-auto mb-4`}>
      <span className="text-xl font-black">{config.label}</span>
      <div className="absolute -bottom-1 flex gap-1 justify-center w-full">
        <div className={`w-1.5 h-3 transform -rotate-12 rounded-sm ${position === 1 ? 'bg-amber-500' : position === 2 ? 'bg-slate-400' : 'bg-orange-600'}`} />
        <div className={`w-1.5 h-3 transform rotate-12 rounded-sm ${position === 1 ? 'bg-amber-500' : position === 2 ? 'bg-slate-400' : 'bg-orange-600'}`} />
      </div>
    </div>
  );
}

export default function Podium({ rows = [] }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  // Reorder to: 2nd place (left), 1st place (center), 3rd place (right)
  const podiumOrder = [];
  if (top[1]) podiumOrder.push({ ...top[1], position: 2 });
  if (top[0]) podiumOrder.push({ ...top[0], position: 1 });
  if (top[2]) podiumOrder.push({ ...top[2], position: 3 });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center pt-4">
      {podiumOrder.map((r) => {
        const isFirst = r.position === 1;
        return (
          <Card 
            key={r.key} 
            className={cn(
              'p-6 text-center border transition-all duration-300 relative bg-card',
              isFirst 
                ? 'border-yellow-500/80 shadow-lg md:scale-105 md:-translate-y-2 ring-4 ring-yellow-500/10 z-10' 
                : 'border-border/60 shadow-sm'
            )}
          >
            {/* Medalha */}
            <PodiumBadge position={r.position} />

            {/* Célula e Turno */}
            <p className="font-extrabold text-lg text-foreground truncate">{r.cell}</p>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">{r.shift}</p>

            {/* Atingimento e Pontos */}
            <p className={cn(
              'text-3xl font-black mt-4 tracking-tight',
              r.attainment >= 90 ? 'text-emerald-600' : 'text-amber-500'
            )}>
              {r.attainment}%
            </p>
            <p className="text-xs font-bold text-muted-foreground mt-2 bg-secondary/35 py-1 px-3 rounded-full inline-block">
              {r.points.toLocaleString('pt-BR')} pts
            </p>
          </Card>
        );
      })}
    </div>
  );
}
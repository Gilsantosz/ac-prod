import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function MedalBadge({ rank }) {
  const configs = {
    1: {
      medal: '#FBBF24',   // Amber 400
      accent: '#F59E0B',  // Amber 500
      dark: '#78350F',    // Amber 900
      ribbonLeft: '#D97706', // Amber 600
      ribbonRight: '#B45309', // Amber 700
    },
    2: {
      medal: '#E2E8F0',   // Slate 200
      accent: '#CBD5E1',  // Slate 300
      dark: '#475569',    // Slate 600
      ribbonLeft: '#94A3B8', // Slate 400
      ribbonRight: '#64748B', // Slate 500
    },
    3: {
      medal: '#FFEDD5',   // Orange 100
      accent: '#FED7AA',  // Orange 200
      dark: '#9A3412',    // Orange 800
      ribbonLeft: '#EA580C', // Orange 600
      ribbonRight: '#C2410C', // Orange 700
    }
  };

  const c = configs[rank] || configs[1];

  return (
    <div className="relative flex justify-center mb-3">
      <svg className="w-16 h-16 drop-shadow-md" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Ribbon Left */}
        <path d="M26 36 L15 58 L27 51 L32 58 L30 40 Z" fill={c.ribbonLeft} />
        {/* Ribbon Right */}
        <path d="M38 36 L49 58 L37 51 L32 58 L34 40 Z" fill={c.ribbonRight} />
        
        {/* Medal Base */}
        <circle cx="32" cy="28" r="19" fill={c.medal} stroke="#FFFFFF" strokeWidth="2" />
        
        {/* Medal Inner Ring */}
        <circle cx="32" cy="28" r="15" fill={c.accent} stroke="#FFFFFF" strokeWidth="1" strokeDasharray="2 2" />

        {/* Shine highlight */}
        <path d="M22 22 C25 18, 39 18, 42 22" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

        {/* Rank Number */}
        <text x="32" y="34" fill={c.dark} fontSize="18" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
          {rank}
        </text>
      </svg>
    </div>
  );
}

export default function Podium({ rows = [] }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  // Map ranking indexes to their respective cards
  // We want to render Silver (2nd) on left, Gold (1st) in center, Bronze (3rd) on right
  const cards = [
    { rank: 2, data: top[1] },
    { rank: 1, data: top[0] },
    { rank: 3, data: top[2] }
  ].filter(c => c.data !== undefined);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end max-w-5xl mx-auto py-6">
      {cards.map((c) => {
        const r = c.data;
        const isGold = c.rank === 1;
        const isSilver = c.rank === 2;
        const isBronze = c.rank === 3;

        return (
          <Card 
            key={r.key} 
            className={cn(
              "bg-white rounded-3xl p-6 text-center transition-all duration-300 flex flex-col justify-between items-center w-full",
              isGold ? "border-2 border-yellow-400 shadow-[0_15px_40px_rgba(234,179,8,0.12)] min-h-[300px] md:scale-105 md:order-2 order-1" :
              isSilver ? "border border-slate-200 shadow-[0_10px_30px_rgba(148,163,184,0.08)] min-h-[260px] md:order-1 order-2" :
              "border border-orange-200 shadow-[0_10px_30px_rgba(217,119,6,0.06)] min-h-[260px] md:order-3 order-3"
            )}
          >
            <div className="w-full flex flex-col items-center">
              <MedalBadge rank={c.rank} />
              <h3 className="font-bold text-slate-800 text-lg truncate w-full max-w-[180px]">{r.cell}</h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">{r.shift}</p>
            </div>
            
            <div className="w-full mt-4">
              <p className={cn(
                "text-3xl font-black tracking-tight",
                isGold ? "text-emerald-600" : "text-slate-800"
              )}>
                {r.attainment}%
              </p>
              <p className="text-xs text-slate-400 font-semibold mt-1">
                {r.points.toLocaleString('pt-BR')} pts
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
import { Card } from '@/components/ui/card';
import { Trophy, Medal, Award } from 'lucide-react';
import { cn } from '@/lib/utils';

const STYLES = [
  { icon: Trophy, color: 'text-yellow-500', ring: 'ring-yellow-300', order: 'order-2', scale: 'scale-105' },
  { icon: Medal, color: 'text-slate-400', ring: 'ring-slate-300', order: 'order-1', scale: '' },
  { icon: Award, color: 'text-amber-600', ring: 'ring-amber-300', order: 'order-3', scale: '' },
];

export default function Podium({ rows = [] }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-4 items-end">
      {top.map((r, i) => {
        const s = STYLES[i];
        const Icon = s.icon;
        return (
          <Card key={r.key} className={cn('p-5 text-center ring-2', s.ring, s.order, s.scale)}>
            <Icon className={cn('w-8 h-8 mx-auto mb-2', s.color)} />
            <p className="font-semibold truncate">{r.cell}</p>
            <p className="text-xs text-muted-foreground">{r.shift}</p>
            <p className="text-2xl font-bold mt-2">{r.attainment}%</p>
            <p className="text-xs text-muted-foreground">{r.points.toLocaleString('pt-BR')} pts</p>
          </Card>
        );
      })}
    </div>
  );
}
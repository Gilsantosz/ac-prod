import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calendar, X } from 'lucide-react';
import { format, startOfQuarter, endOfQuarter, subMonths } from 'date-fns';

const fmt = (d) => format(d, 'yyyy-MM-dd');

export default function DateRangeFilter({ range, setRange }) {
  const now = new Date();

  const presets = [
    { label: 'Últimos 3 meses', from: fmt(subMonths(now, 3)), to: fmt(now) },
    { label: 'Últimos 6 meses', from: fmt(subMonths(now, 6)), to: fmt(now) },
    { label: 'Trimestre atual', from: fmt(startOfQuarter(now)), to: fmt(endOfQuarter(now)) },
    { label: 'Ano atual', from: `${now.getFullYear()}-01-01`, to: fmt(now) },
  ];

  const set = (k, v) => setRange((r) => ({ ...r, [k]: v }));
  const active = range.from || range.to;

  return (
    <Card className="p-4 border-border/60">
      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs"><Calendar className="w-3.5 h-3.5" /> De</Label>
            <Input type="date" value={range.from} onChange={(e) => set('from', e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={range.to} onChange={(e) => set('to', e.target.value)} className="w-44" />
          </div>
          {active && (
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setRange({ from: '', to: '' })}>
              <X className="w-4 h-4" /> Limpar
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          {presets.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setRange({ from: p.from, to: p.to })}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
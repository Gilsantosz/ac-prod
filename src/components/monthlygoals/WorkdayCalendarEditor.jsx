import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { monthDates, calendarMap, isWorkdayDate, workdaysInMonth } from '@/lib/workdays';

const WD_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// Editor visual: clique em um dia alterna útil/não-útil (sobrepondo o padrão seg-sex).
export default function WorkdayCalendarEditor({ entries = [], onToggle }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const map = useMemo(() => calendarMap(entries), [entries]);
  const dates = useMemo(() => monthDates(month), [month]);
  const firstDow = new Date(month + '-01T00:00:00').getDay();

  return (
    <Card className="max-w-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-3 py-3 px-4">
        <div>
          <CardTitle className="text-sm">Calendário de Dias Úteis</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {workdaysInMonth(month, map)} dias úteis · clique para marcar feriado/folga
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Mês</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-7 gap-1 max-w-sm">
          {WD_LABELS.map((l, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">{l}</div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
          {dates.map((date) => {
            const work = isWorkdayDate(date, map);
            const overridden = date in map;
            return (
              <button
                key={date}
                onClick={() => onToggle(date, !work)}
                className={cn(
                  'h-8 w-8 rounded-md text-xs font-medium border transition-colors flex items-center justify-center relative',
                  work
                    ? 'bg-green-50 border-green-200 text-green-800 hover:bg-green-100'
                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                )}
                title={work ? 'Dia útil' : 'Não útil'}
              >
                {Number(date.slice(-2))}
                {overridden && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-slate-500" />}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-100 border border-green-200" /> Dia útil</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> Não útil</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Marcado manualmente</span>
        </div>
      </CardContent>
    </Card>
  );
}

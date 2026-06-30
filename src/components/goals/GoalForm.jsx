import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Target } from 'lucide-react';
import { format } from 'date-fns';

const empty = {
  date: format(new Date(), 'yyyy-MM-dd'),
  shift: '1º Turno',
  cell: '',
  target: '',
};

const HOURS_KEY = { '1º Turno': 'hoursShift1', '2º Turno': 'hoursShift2', '3º Turno': 'hoursShift3' };

export default function GoalForm({ onSubmit, saving, cells = [] }) {
  const [data, setData] = useState(empty);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const selectedCell = cells.find((c) => c.name === data.cell);
  const shiftHours = selectedCell ? selectedCell[HOURS_KEY[data.shift]] ?? 8 : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ ...data, target: Number(data.target) || 0, hours: shiftHours ?? undefined });
    setData({ ...empty, date: data.date, shift: data.shift });
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Data</Label>
            <Input type="date" value={data.date} onChange={(e) => set('date', e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Turno</Label>
            <Select value={data.shift} onValueChange={(v) => set('shift', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1º Turno">1º Turno</SelectItem>
                <SelectItem value="2º Turno">2º Turno</SelectItem>
                <SelectItem value="3º Turno">3º Turno</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Célula</Label>
            <Select value={data.cell} onValueChange={(v) => set('cell', v)} required>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {cells.length === 0 && <SelectItem value="__none" disabled>Cadastre células primeiro</SelectItem>}
                {cells.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Meta do turno</Label>
            <Input type="number" value={data.target} onChange={(e) => set('target', e.target.value)} placeholder="0" required />
          </div>
        </div>

        {shiftHours != null && (
          <p className="text-sm text-muted-foreground">
            Horas trabalhadas no {data.shift} para {data.cell}: <span className="font-medium text-foreground">{shiftHours}h</span>
          </p>
        )}

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            Salvar meta
          </Button>
        </div>
      </form>
    </div>
  );
}

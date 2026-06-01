import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Target } from 'lucide-react';
import { format } from 'date-fns';

export default function MonthlyGoalForm({ onSubmit, saving, cells = [], workdays, dailyPreview }) {
  const [data, setData] = useState({
    month: format(new Date(), 'yyyy-MM'),
    shift: '1º Turno',
    cell: '',
    monthlyTarget: '',
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ ...data, monthlyTarget: Number(data.monthlyTarget) || 0 });
    setData((d) => ({ ...d, cell: '', monthlyTarget: '' }));
  };

  const preview = data.monthlyTarget ? dailyPreview(Number(data.monthlyTarget), data.month) : null;

  return (
    <Card className="p-6 border-border/60">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Mês</Label>
            <Input type="month" value={data.month} onChange={(e) => set('month', e.target.value)} required />
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
            <Label>Meta mensal</Label>
            <Input type="number" value={data.monthlyTarget} onChange={(e) => set('monthlyTarget', e.target.value)} placeholder="0" required />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Dias úteis em {data.month}: <span className="font-medium text-foreground">{workdays(data.month)}</span>
          {preview != null && <> · Meta diária ajustada: <span className="font-medium text-foreground">{preview.toLocaleString('pt-BR')}</span></>}
        </p>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            Salvar meta mensal
          </Button>
        </div>
      </form>
    </Card>
  );
}
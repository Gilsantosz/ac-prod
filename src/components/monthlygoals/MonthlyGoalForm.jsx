import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Target, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

export default function MonthlyGoalForm({ onSubmit, saving, cells = [], workdays, dailyPreview, goals = [] }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [cell, setCell] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [existingId, setExistingId] = useState(null);

  useEffect(() => {
    if (!cell || !month) return;
    const found = goals.find((g) => g.month === month && g.cell === cell);
    if (found) {
      setMonthlyTarget(String(found.monthlyTarget ?? ''));
      setExistingId(found.id);
    } else {
      setMonthlyTarget('');
      setExistingId(null);
    }
  }, [month, cell, goals]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ month, cell, monthlyTarget: Number(monthlyTarget) || 0, existingId });
    setCell('');
    setMonthlyTarget('');
    setExistingId(null);
  };

  const preview = monthlyTarget ? dailyPreview(Number(monthlyTarget), month) : null;
  const days = workdays(month);
  const isEditing = !!existingId;

  return (
    <div className="p-5 border border-border/60 rounded-2xl bg-card space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Mes</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Celula</Label>
            <Select value={cell} onValueChange={setCell} required>
              <SelectTrigger><SelectValue placeholder="Selecione a celula" /></SelectTrigger>
              <SelectContent>
                {cells.length === 0 && <SelectItem value="__none" disabled>Cadastre celulas primeiro</SelectItem>}
                {cells.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Meta mensal (todos os turnos)</Label>
              {isEditing && (
                <span className="flex items-center gap-1 text-xs text-[#2d9c4a] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Editando
                </span>
              )}
            </div>
            <Input
              type="number"
              min="0"
              value={monthlyTarget}
              onChange={(e) => setMonthlyTarget(e.target.value)}
              placeholder="0"
              required
              className={isEditing ? 'border-[#2d9c4a]/50 bg-[#2d9c4a]/5' : ''}
            />
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            Dias uteis em {month}: <span className="font-semibold text-foreground">{days}</span>
            {preview != null && (
              <> Meta diaria: <span className="font-semibold text-foreground">{preview.toLocaleString('pt-BR')}</span></>
            )}
          </p>
          <Button type="submit" disabled={saving || !cell} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {isEditing ? 'Atualizar meta mensal' : 'Salvar meta mensal'}
          </Button>
        </div>
      </form>
    </div>
  );
}

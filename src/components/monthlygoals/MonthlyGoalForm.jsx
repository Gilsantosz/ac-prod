import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Target, CheckCircle2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';

export default function MonthlyGoalForm({ onSubmit, saving, cells = [], workdays, dailyPreview, goals = [] }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [cell, setCell] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [existingId, setExistingId] = useState(null);
  const [loadingSum, setLoadingSum] = useState(false);
  const [computedSum, setComputedSum] = useState(null); // soma calculada do Supabase

  // Carrega meta salva e/ou soma de production_daily_goals
  const loadData = useCallback(async () => {
    if (!cell || !month) return;

    // 1) Verifica se ha meta mensal ja salva
    const found = goals.find((g) => g.month === month && g.cell === cell);
    if (found) {
      setMonthlyTarget(String(found.monthlyTarget ?? ''));
      setExistingId(found.id);
      setComputedSum(null);
      return;
    }

    // 2) Calcula soma total de targets em production_daily_goals para o mes+celula
    setExistingId(null);
    setLoadingSum(true);
    try {
      const start = month + '-01';
      // ultimo dia do mes
      const d = new Date(month + '-01');
      d.setMonth(d.getMonth() + 1);
      d.setDate(0);
      const end = month + '-' + String(d.getDate()).padStart(2, '0');

      const { data, error } = await supabase
        .from('production_daily_goals')
        .select('target')
        .eq('cell_name', cell)
        .gte('date', start)
        .lte('date', end);

      if (!error && data && data.length > 0) {
        const total = data.reduce((acc, row) => acc + (Number(row.target) || 0), 0);
        setComputedSum(total);
        setMonthlyTarget(String(total));
      } else {
        setComputedSum(null);
        setMonthlyTarget('');
      }
    } catch (err) {
      console.warn('Erro ao somar metas diarias:', err.message);
      setComputedSum(null);
      setMonthlyTarget('');
    } finally {
      setLoadingSum(false);
    }
  }, [cell, month, goals]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ month, cell, monthlyTarget: Number(monthlyTarget) || 0, existingId });
    setCell('');
    setMonthlyTarget('');
    setExistingId(null);
    setComputedSum(null);
  };

  const preview = monthlyTarget ? dailyPreview(Number(monthlyTarget), month) : null;
  const days = workdays(month);
  const isEditing = !!existingId;
  const isSuggested = !isEditing && computedSum !== null;

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
            <Select value={cell} onValueChange={setCell}>
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
              {loadingSum && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              {!loadingSum && isEditing && (
                <span className="flex items-center gap-1 text-xs text-[#2d9c4a] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Salvo
                </span>
              )}
              {!loadingSum && isSuggested && (
                <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                  <RefreshCw className="w-3 h-3" /> Calculado das metas diarias
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
              className={isEditing ? 'border-[#2d9c4a]/50 bg-[#2d9c4a]/5' : isSuggested ? 'border-blue-400/50 bg-blue-50/30 dark:bg-blue-900/10' : ''}
            />
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            Dias uteis em {month}: <span className="font-semibold text-foreground">{days}</span>
            {preview != null && (
              <> · Meta diaria media: <span className="font-semibold text-foreground">{preview.toLocaleString('pt-BR')}</span></>
            )}
          </p>
          <Button type="submit" disabled={saving || !cell || loadingSum} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {isEditing ? 'Atualizar meta mensal' : 'Salvar meta mensal'}
          </Button>
        </div>
      </form>
    </div>
  );
}

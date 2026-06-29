import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Boxes, Target, CalendarRange, Plus, Trash2,
  ChevronLeft, ChevronRight, Factory, Pencil, ChevronDown, ChevronUp,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import CellForm from '@/components/cells/CellForm';
import DailyGoalEditor from '@/components/daily/DailyGoalEditor';
import MonthlyGoalsManager from '@/components/monthlygoals/MonthlyGoalsManager';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const todayStr = () => new Date().toISOString().slice(0, 10);

function GoalCard({ goal, onDelete }) {
  const unitLabel = goal.metric_unit_label || goal.metric_unit || 'pecas';
  const targetVal = Number(goal.target ?? 0).toLocaleString('pt-BR');
  const capacityVal = Number(goal.capacity ?? 0).toLocaleString('pt-BR');
  const pct = goal.capacity > 0 ? Math.round((goal.target / goal.capacity) * 100) : null;

  return (
    <Card className="p-4 flex items-center gap-4 border-border/60 shadow-sm">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Target className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm truncate">{goal.cell_name || goal.area_name}</p>
          <Badge variant="secondary" className="text-xs">{goal.shift}</Badge>
          <Badge variant="outline" className="text-xs font-mono">{unitLabel}</Badge>
          {pct !== null && (
            <Badge className={`text-xs ${
              pct >= 100 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : pct >= 80 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {pct}% do cap.
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Meta: <span className="font-semibold text-foreground">{targetVal}</span>
          {goal.capacity > 0 && ` · Cap: ${capacityVal}`}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => onDelete(goal.id)}>
        <Trash2 className="w-4 h-4" />
      </Button>
    </Card>
  );
}

function CollapsibleSection({ title, icon: Icon, badge, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/60 rounded-2xl overflow-hidden shadow-sm bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <span className="font-semibold text-foreground text-sm sm:text-base">{title}</span>
          {badge != null && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-4 space-y-3 border-t border-border/40">
          {children}
        </div>
      )}
    </div>
  );
}

export default function CellsAndGoals() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [cellDialogOpen, setCellDialogOpen] = useState(false);
  const [cellSaving, setCellSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);

  const { data: cells = [] } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('-created_date', 200),
    initialData: [],
  });

  const { data: goals = [], refetch: refetchGoals } = useQuery({
    queryKey: ['productionDailyGoals', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_daily_goals')
        .select('*')
        .eq('date', date)
        .order('shift')
        .order('cell_name');
      if (error) {
        if (/schema cache|does not exist|production_daily_goals/i.test(error.message || '')) return [];
        throw error;
      }
      return data || [];
    },
    initialData: [],
  });

  const activeCells = useMemo(() => cells.filter((c) => c.active !== false), [cells]);

  const invalidateCells = () => queryClient.invalidateQueries({ queryKey: ['cells'] });

  const createCell = useMutation({
    mutationFn: (payload) => base44.entities.Cell.create(payload),
    onSuccess: () => { invalidateCells(); toast.success('Celula cadastrada'); setCellDialogOpen(false); },
    onError: () => toast.error('Falha ao cadastrar celula'),
  });

  const updateCell = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.Cell.update(id, payload),
    onSuccess: () => { invalidateCells(); toast.success('Celula atualizada'); setEditingCell(null); setCellDialogOpen(false); },
    onError: () => toast.error('Falha ao atualizar celula'),
  });

  const removeCell = useMutation({
    mutationFn: (id) => base44.entities.Cell.delete(id),
    onSuccess: () => { invalidateCells(); toast.success('Celula removida'); },
  });

  const removeGoal = useMutation({
    mutationFn: (id) => supabase.from('production_daily_goals').delete().eq('id', id),
    onSuccess: () => { refetchGoals(); toast.success('Meta removida'); },
    onError: () => toast.error('Falha ao remover meta'),
  });

  const handleCellSubmit = async (payload) => {
    setCellSaving(true);
    try {
      if (editingCell) await updateCell.mutateAsync({ id: editingCell.id, payload });
      else await createCell.mutateAsync(payload);
    } finally {
      setCellSaving(false);
    }
  };

  const navigateDate = (delta) => {
    const d = delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1);
    setDate(d.toISOString().slice(0, 10));
  };

  const formattedDate = useMemo(() => {
    try { return format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR }); }
    catch { return date; }
  }, [date]);

  const goalsByShift = useMemo(() => {
    const map = { '1 Turno': [], '2 Turno': [], '3 Turno': [] };
    for (const g of goals) {
      const key = g.shift || '1 Turno';
      if (!map[key]) map[key] = [];
      map[key].push(g);
    }
    return map;
  }, [goals]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <PageHeader
          title="Celulas e Metas"
          subtitle="Configure as celulas de producao e defina as metas diarias para os turnos."
          icon={Boxes}
        />
        <Button
          onClick={() => { setEditingCell(null); setCellDialogOpen(true); }}
          className="gap-2 rounded-full shadow-sm self-start sm:self-auto shrink-0"
        >
          <Plus className="w-4 h-4" /> Nova Celula
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => navigateDate(-1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto rounded-lg text-sm h-8 border-border/60"
        />
        <span className="text-sm text-muted-foreground capitalize hidden sm:inline">{formattedDate}</span>
        <Button variant="outline" size="icon" className="rounded-full h-8 w-8" onClick={() => navigateDate(1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        {date !== todayStr() && (
          <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setDate(todayStr())}>
            Hoje
          </Button>
        )}
      </div>

      <DailyGoalEditor date={date} activeCells={activeCells} onSaved={refetchGoals} />

      <CollapsibleSection title="Metas Diarias Definidas" icon={Target} badge={goals.length || null} defaultOpen>
        {goals.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-2xl text-sm">
            Nenhuma meta definida. Crie uma meta acima para acompanhar o progresso no painel.
          </div>
        ) : (
          <div className="space-y-5">
            {['1 Turno', '2 Turno', '3 Turno'].map((shift) => {
              const sg = goalsByShift[shift] || [];
              if (!sg.length) return null;
              return (
                <div key={shift} className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">{shift}</p>
                  <div className="space-y-2">
                    {sg.map((g) => <GoalCard key={g.id} goal={g} onDelete={(id) => removeGoal.mutate(id)} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Celulas Cadastradas" icon={Boxes} badge={cells.length || null} defaultOpen={false}>
        {cells.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-2xl text-sm">
            Nenhuma celula cadastrada. Clique em "Nova Celula" para comecar.
          </div>
        ) : (
          <div className="space-y-3">
            {cells.map((c) => (
              <Card key={c.id} className="p-4 flex items-center gap-4 border-border/60">
                <div className="w-10 h-10 rounded-xl bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                  <Factory className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate text-sm">{c.name}</p>
                    {c.active === false && <Badge variant="outline" className="text-xs">Inativa</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Horas/turno: 1 {c.hoursShift1 ?? 8}h · 2 {c.hoursShift2 ?? 8}h · 3 {c.hoursShift3 ?? 8}h
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground"
                  onClick={() => { setEditingCell(c); setCellDialogOpen(true); }}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeCell.mutate(c.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Configuracao de Metas Mensais" icon={CalendarRange} defaultOpen={false}>
        <MonthlyGoalsManager />
      </CollapsibleSection>

      <Dialog open={cellDialogOpen} onOpenChange={setCellDialogOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingCell ? 'Editar Celula' : 'Cadastrar Nova Celula'}</DialogTitle>
            <DialogDescription>
              Insira o nome da celula e configure as horas trabalhadas em cada turno.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <CellForm
              onSubmit={handleCellSubmit}
              saving={cellSaving}
              editing={editingCell}
              onCancel={() => { setEditingCell(null); setCellDialogOpen(false); }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

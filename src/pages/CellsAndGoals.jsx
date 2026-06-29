import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Boxes, Target, CalendarRange, Plus, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import CellForm from '@/components/cells/CellForm';
import CellList from '@/components/cells/CellList';
import DailyGoalEditor from '@/components/daily/DailyGoalEditor';
import MonthlyGoalsManager from '@/components/monthlygoals/MonthlyGoalsManager';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const todayStr = () => new Date().toISOString().slice(0, 10);

function GoalCard({ goal, onDelete }) {
  const unitLabel = goal.metric_unit_label || goal.metric_unit || 'peças';
  const target = Number(goal.target ?? 0).toLocaleString('pt-BR');
  const capacity = Number(goal.capacity ?? 0).toLocaleString('pt-BR');
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
            <Badge
              className={`text-xs ${pct >= 100 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : pct >= 80 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}
            >
              {pct}% do cap.
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Meta: <span className="font-semibold text-foreground">{target}</span>
          {goal.capacity > 0 && ` · Cap: ${capacity}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive shrink-0"
        onClick={() => onDelete(goal.id)}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </Card>
  );
}

export default function CellsAndGoals() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());

  // Dialog & state for Cells
  const [cellDialogOpen, setCellDialogOpen] = useState(false);
  const [cellSaving, setCellSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);

  // Fetch Cells
  const { data: cells = [] } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('-created_date', 200),
    initialData: [],
  });

  // Fetch Goals for selected date
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

  // Mutations for Cells
  const invalidateCells = () => queryClient.invalidateQueries({ queryKey: ['cells'] });

  const createCell = useMutation({
    mutationFn: (payload) => base44.entities.Cell.create(payload),
    onSuccess: () => {
      invalidateCells();
      toast.success('Célula cadastrada');
      setCellDialogOpen(false);
    },
    onError: () => toast.error('Falha ao cadastrar célula'),
  });

  const updateCell = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.Cell.update(id, payload),
    onSuccess: () => {
      invalidateCells();
      toast.success('Célula atualizada');
      setEditingCell(null);
      setCellDialogOpen(false);
    },
    onError: () => toast.error('Falha ao atualizar célula'),
  });

  const removeCell = useMutation({
    mutationFn: (id) => base44.entities.Cell.delete(id),
    onSuccess: () => {
      invalidateCells();
      toast.success('Célula removida');
    },
  });

  const removeGoal = useMutation({
    mutationFn: (id) =>
      supabase.from('production_daily_goals').delete().eq('id', id),
    onSuccess: () => {
      refetchGoals();
      toast.success('Meta removida');
    },
    onError: () => toast.error('Falha ao remover meta'),
  });

  const handleCellSubmit = async (payload) => {
    setCellSaving(true);
    try {
      if (editingCell) {
        await updateCell.mutateAsync({ id: editingCell.id, payload });
      } else {
        await createCell.mutateAsync(payload);
      }
    } finally {
      setCellSaving(false);
    }
  };

  const navigateDate = (delta) => {
    const d = delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1);
    setDate(d.toISOString().slice(0, 10));
  };

  const formattedDate = useMemo(() => {
    try {
      return format(parseISO(date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return date;
    }
  }, [date]);

  // Group goals by shift for display
  const goalsByShift = useMemo(() => {
    const map = { '1º Turno': [], '2º Turno': [], '3º Turno': [] };
    for (const g of goals) {
      const key = g.shift || '1º Turno';
      if (!map[key]) map[key] = [];
      map[key].push(g);
    }
    return map;
  }, [goals]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Células e Metas"
        subtitle="Configure as células de produção e defina as metas diárias para os turnos."
        icon={Boxes}
      />

      <Tabs defaultValue="goals" className="space-y-6">
        <TabsList>
          <TabsTrigger value="goals" className="gap-2">
            <Target className="w-4 h-4" /> Metas Diárias
          </TabsTrigger>
          <TabsTrigger value="cells" className="gap-2">
            <Boxes className="w-4 h-4" /> Células
          </TabsTrigger>
          <TabsTrigger value="monthly" className="gap-2">
            <CalendarRange className="w-4 h-4" /> Configuração de Metas
          </TabsTrigger>
        </TabsList>

        {/* ── Aba Metas Diárias ──────────────────────────────── */}
        <TabsContent value="goals" className="space-y-5">

          {/* Seletor de Data */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-8 w-8"
              onClick={() => navigateDate(-1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto rounded-lg text-sm h-8 border-border/60"
              />
              <span className="text-sm text-muted-foreground hidden sm:inline capitalize">
                {formattedDate}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-8 w-8"
              onClick={() => navigateDate(1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {date !== todayStr() && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => setDate(todayStr())}
              >
                Hoje
              </Button>
            )}
          </div>

          {/* Editor de metas inline – igual à Imagem 1 */}
          <DailyGoalEditor
            date={date}
            activeCells={activeCells}
            onSaved={refetchGoals}
          />

          {/* Lista de metas do dia */}
          <Card className="p-5 border-border/60 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-base text-foreground">Metas Diárias Definidas</h2>
              </div>
              <Badge variant="secondary" className="text-xs">
                {goals.length} meta{goals.length !== 1 ? 's' : ''}
              </Badge>
            </div>

            {goals.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl text-sm">
                Nenhuma meta definida. Crie uma meta acima para acompanhar o progresso no painel.
              </div>
            ) : (
              <div className="space-y-5">
                {['1º Turno', '2º Turno', '3º Turno'].map((shift) => {
                  const shiftGoals = goalsByShift[shift] || [];
                  if (!shiftGoals.length) return null;
                  return (
                    <div key={shift} className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                        {shift}
                      </p>
                      <div className="space-y-2">
                        {shiftGoals.map((g) => (
                          <GoalCard
                            key={g.id}
                            goal={g}
                            onDelete={(id) => removeGoal.mutate(id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Aba Células ────────────────────────────────────── */}
        <TabsContent value="cells" className="space-y-5">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingCell(null);
                setCellDialogOpen(true);
              }}
              className="gap-2 rounded-full shadow-sm"
            >
              <Plus className="w-4 h-4" /> Nova Célula
            </Button>
          </div>

          <Card className="p-5 border-border/60 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Boxes className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-base text-foreground">Células Cadastradas</h2>
            </div>
            <div className="overflow-y-auto max-h-[600px] pr-1">
              <CellList
                cells={cells}
                onEdit={(cell) => {
                  setEditingCell(cell);
                  setCellDialogOpen(true);
                }}
                onDelete={(id) => removeCell.mutate(id)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Aba Config. Mensais ────────────────────────────── */}
        <TabsContent value="monthly">
          <MonthlyGoalsManager />
        </TabsContent>
      </Tabs>

      {/* Dialog Célula */}
      <Dialog open={cellDialogOpen} onOpenChange={setCellDialogOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingCell ? 'Editar Célula' : 'Cadastrar Nova Célula'}</DialogTitle>
            <DialogDescription>
              Insira o nome da célula e configure as horas trabalhadas em cada turno.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <CellForm
              onSubmit={handleCellSubmit}
              saving={cellSaving}
              editing={editingCell}
              onCancel={() => {
                setEditingCell(null);
                setCellDialogOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
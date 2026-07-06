import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Boxes, Target, CalendarRange, Plus, Trash2,
  ChevronLeft, ChevronRight, Factory, Pencil, 
  ChevronDown, ChevronUp, Users, Search, RefreshCw,
  Sliders, Link as LinkIcon, ExternalLink
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import CellForm from '@/components/cells/CellForm';
import DailyGoalEditor from '@/components/daily/DailyGoalEditor';
import MonthlyGoalsManager from '@/components/monthlygoals/MonthlyGoalsManager';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { Link } from 'react-router-dom';

import {
  getCells,
  getActiveCells,
  createCell,
  updateCell,
  deactivateCell,
  deleteCell,
  getWorkstations,
  createWorkstation,
  updateWorkstation,
  deactivateWorkstation,
  deleteWorkstation,
  getProductionGoals,
  deleteProductionGoal,
  getCellsGoalsSummary
} from '@/lib/cellsGoalsService';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function CellsAndGoals() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('cells');
  const [date, setDate] = useState(todayStr());
  
  // Modais de Célula
  const [cellDialogOpen, setCellDialogOpen] = useState(false);
  const [cellSaving, setCellSaving] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  
  // Modais de Máquina/Posto
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [machineSaving, setMachineSaving] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  
  // Estados de formulário de Máquina/Posto
  const [mName, setMName] = useState('');
  const [mCell, setMCell] = useState('');
  const [mStation, setMStation] = useState('');
  const [mUnit, setMUnit] = useState('peças');
  const [mActive, setMActive] = useState(true);

  // Filtros e buscas
  const [cellSearch, setCellSearch] = useState('');
  const [cellStatusFilter, setCellStatusFilter] = useState('all');
  const [machineSearch, setMachineSearch] = useState('');
  const [machineCellFilter, setMachineCellFilter] = useState('all');

  // ─── CONSULTAS ─────────────────────────────────────────────────────────────

  // Células
  const { data: cells = [], refetch: refetchCells, isLoading: cellsLoading } = useQuery({
    queryKey: ['cells-admin-list'],
    queryFn: getCells,
    initialData: [],
  });

  // Células ativas (para seletores)
  const activeCells = useMemo(() => cells.filter(c => c.active !== false), [cells]);

  // Máquinas/Postos
  const { data: machines = [], refetch: refetchMachines, isLoading: machinesLoading } = useQuery({
    queryKey: ['machines-admin-list'],
    queryFn: getWorkstations,
    initialData: [],
  });

  // Metas do dia
  const { data: goals = [], refetch: refetchGoals, isLoading: goalsLoading } = useQuery({
    queryKey: ['production-daily-goals', date],
    queryFn: () => getProductionGoals(date),
    initialData: [],
  });

  // Resumo de KPIs do dia
  const { data: summary = { totalCells: 0, activeCells: 0, totalMachines: 0, activeGoals: 0, cellsWithoutGoal: 0 }, refetch: refetchSummary } = useQuery({
    queryKey: ['cells-goals-summary', date],
    queryFn: () => getCellsGoalsSummary(date),
  });

  // Operadores (para a aba de Vínculos)
  const { data: operators = [], isLoading: operatorsLoading } = useQuery({
    queryKey: ['operators-admin-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operators').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
    initialData: []
  });

  // ─── MUTATIONS ─────────────────────────────────────────────────────────────

  // Células
  const mutationCreateCell = useMutation({
    mutationFn: createCell,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cells-admin-list'] });
      refetchSummary();
      toast.success('Célula cadastrada com sucesso');
      setCellDialogOpen(false);
    },
    onError: (err) => toast.error(`Erro ao cadastrar célula: ${err.message}`),
  });

  const mutationUpdateCell = useMutation({
    mutationFn: ({ id, payload }) => updateCell(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cells-admin-list'] });
      refetchSummary();
      toast.success('Célula atualizada com sucesso');
      setEditingCell(null);
      setCellDialogOpen(false);
    },
    onError: (err) => toast.error(`Erro ao atualizar célula: ${err.message}`),
  });

  const mutationDeleteCell = useMutation({
    mutationFn: deleteCell,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cells-admin-list'] });
      refetchSummary();
      toast.success('Célula removida com sucesso');
    },
    onError: (err) => toast.error(`Erro ao remover célula: ${err.message}`),
  });

  const mutationToggleCellActive = useMutation({
    mutationFn: ({ id, active }) => updateCell(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cells-admin-list'] });
      refetchSummary();
      toast.success('Status da célula atualizado');
    },
    onError: (err) => toast.error(`Erro ao atualizar status: ${err.message}`),
  });

  // Máquinas/Postos
  const mutationCreateMachine = useMutation({
    mutationFn: createWorkstation,
    onSuccess: () => {
      refetchMachines();
      refetchSummary();
      toast.success('Máquina/Posto cadastrado com sucesso');
      setMachineDialogOpen(false);
    },
    onError: (err) => toast.error(`Erro ao cadastrar posto: ${err.message}`),
  });

  const mutationUpdateMachine = useMutation({
    mutationFn: ({ id, payload }) => updateWorkstation(id, payload),
    onSuccess: () => {
      refetchMachines();
      refetchSummary();
      toast.success('Máquina/Posto atualizado com sucesso');
      setEditingMachine(null);
      setMachineDialogOpen(false);
    },
    onError: (err) => toast.error(`Erro ao atualizar posto: ${err.message}`),
  });

  const mutationDeleteMachine = useMutation({
    mutationFn: deleteWorkstation,
    onSuccess: () => {
      refetchMachines();
      refetchSummary();
      toast.success('Máquina/Posto excluído com sucesso');
    },
    onError: (err) => toast.error(`Erro ao excluir posto: ${err.message}`),
  });

  const mutationToggleMachineActive = useMutation({
    mutationFn: ({ id, active, name, cell_name, station_name, metric_unit }) => 
      updateWorkstation(id, { name, cell_name, station_name, metric_unit, active }),
    onSuccess: () => {
      refetchMachines();
      refetchSummary();
      toast.success('Status do posto atualizado');
    },
    onError: (err) => toast.error(`Erro ao atualizar status: ${err.message}`),
  });

  // Metas
  const mutationDeleteGoal = useMutation({
    mutationFn: deleteProductionGoal,
    onSuccess: () => {
      refetchGoals();
      refetchSummary();
      toast.success('Meta diária removida');
    },
    onError: (err) => toast.error(`Erro ao remover meta: ${err.message}`),
  });

  // ─── SUBSCRIÇÕES REALTIME ──────────────────────────────────────────────────

  useEffect(() => {
    // Sincroniza em tempo real alterações das três tabelas principais
    const channel = supabase
      .channel('cells-goals-realtime-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cells' }, () => {
        refetchCells();
        refetchSummary();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_machines' }, () => {
        refetchMachines();
        refetchSummary();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_daily_goals' }, () => {
        refetchGoals();
        refetchSummary();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetchCells, refetchMachines, refetchGoals, refetchSummary]);

  // ─── AÇÕES DE FORMULÁRIO ───────────────────────────────────────────────────

  const handleCellSubmit = async (payload) => {
    setCellSaving(true);
    try {
      if (editingCell) {
        await mutationUpdateCell.mutateAsync({ id: editingCell.id, payload });
      } else {
        await mutationCreateCell.mutateAsync(payload);
      }
    } finally {
      setCellSaving(false);
    }
  };

  const openNewMachineDialog = () => {
    setEditingMachine(null);
    setMName('');
    setMCell(activeCells[0]?.name || '');
    setMStation('');
    setMUnit('peças');
    setMActive(true);
    setMachineDialogOpen(true);
  };

  const openEditMachineDialog = (mach) => {
    setEditingMachine(mach);
    setMName(mach.name || '');
    setMCell(mach.cell_name || '');
    setMStation(mach.station_name || '');
    setMUnit(mach.metric_unit || 'peças');
    setMActive(mach.active !== false);
    setMachineDialogOpen(true);
  };

  const handleMachineSubmit = async (e) => {
    e.preventDefault();
    if (!mName || !mCell) {
      toast.error('Informe o nome da máquina e a célula vinculada.');
      return;
    }
    
    setMachineSaving(true);
    const payload = {
      name: mName,
      cell_name: mCell,
      station_name: mStation || null,
      metric_unit: mUnit || 'peças',
      active: mActive
    };

    try {
      if (editingMachine) {
        await mutationUpdateMachine.mutateAsync({ id: editingMachine.id, payload });
      } else {
        await mutationCreateMachine.mutateAsync(payload);
      }
    } finally {
      setMachineSaving(false);
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

  // ─── FILTROS DE LISTAGENS ──────────────────────────────────────────────────

  const filteredCells = useMemo(() => {
    return cells.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(cellSearch.toLowerCase()) ||
        (c.description || '').toLowerCase().includes(cellSearch.toLowerCase());
      
      const matchesStatus = cellStatusFilter === 'all' ||
        (cellStatusFilter === 'active' && c.active !== false) ||
        (cellStatusFilter === 'inactive' && c.active === false);

      return matchesSearch && matchesStatus;
    });
  }, [cells, cellSearch, cellStatusFilter]);

  const filteredMachines = useMemo(() => {
    return machines.filter(m => {
      const matchesSearch = m.name.toLowerCase().includes(machineSearch.toLowerCase()) ||
        (m.station_name || '').toLowerCase().includes(machineSearch.toLowerCase());
      
      const matchesCell = machineCellFilter === 'all' || m.cell_name === machineCellFilter;

      return matchesSearch && matchesCell;
    });
  }, [machines, machineSearch, machineCellFilter]);

  const goalsByShift = useMemo(() => {
    const map = {};
    for (const g of goals) {
      const key = g.shift || '1º Turno';
      if (!map[key]) map[key] = [];
      map[key].push(g);
    }
    return map;
  }, [goals]);

  // Vínculos de operários por célula
  const operatorsByCell = useMemo(() => {
    const map = {};
    activeCells.forEach(c => {
      map[c.name] = [];
    });
    map['Outros'] = [];

    operators.forEach(op => {
      const assignedCells = Array.isArray(op.cells) ? op.cells : [];
      if (assignedCells.length > 0) {
        assignedCells.forEach(cellName => {
          if (map[cellName]) map[cellName].push(op);
        });
      } else if (op.primary_cell && map[op.primary_cell]) {
        map[op.primary_cell].push(op);
      } else {
        map['Outros'].push(op);
      }
    });
    return map;
  }, [activeCells, operators]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeader
          title="Células, Máquinas e Metas"
          subtitle="Cadastre células produtivas, postos de trabalho e metas operacionais usadas na coleta, rastreabilidade e dashboards."
          icon={Boxes}
        />
        <div className="flex gap-2">
          {activeTab === 'cells' && (
            <Button
              onClick={() => { setEditingCell(null); setCellDialogOpen(true); }}
              className="gap-2 rounded-xl shadow-sm bg-primary text-primary-foreground hover:bg-primary/95"
            >
              <Plus className="w-4 h-4" /> Nova Célula
            </Button>
          )}
          {activeTab === 'machines' && (
            <Button
              onClick={openNewMachineDialog}
              className="gap-2 rounded-xl shadow-sm bg-primary text-primary-foreground hover:bg-primary/95"
            >
              <Plus className="w-4 h-4" /> Novo Posto
            </Button>
          )}
        </div>
      </div>

      {/* Cards KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <Card className="p-4 bg-card border-border/60 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Total Células</span>
          <p className="text-2xl font-extrabold text-foreground mt-2">{summary.totalCells}</p>
        </Card>
        <Card className="p-4 bg-card border-border/60 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Células Ativas</span>
          <p className="text-2xl font-extrabold text-green-600 dark:text-green-400 mt-2">{summary.activeCells}</p>
        </Card>
        <Card className="p-4 bg-card border-border/60 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Máquinas/Postos</span>
          <p className="text-2xl font-extrabold text-foreground mt-2">{summary.totalMachines}</p>
        </Card>
        <Card className="p-4 bg-card border-border/60 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Metas no Dia</span>
          <p className="text-2xl font-extrabold text-primary mt-2">{summary.activeGoals}</p>
        </Card>
        <Card className="p-4 bg-card border-border/60 shadow-sm flex flex-col justify-between col-span-2 md:col-span-1">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Sem Meta Hoje</span>
          <p className={cn(
            "text-2xl font-extrabold mt-2",
            summary.cellsWithoutGoal > 0 ? "text-amber-500" : "text-muted-foreground"
          )}>{summary.cellsWithoutGoal}</p>
        </Card>
      </div>

      {/* Abas */}
      <div className="flex border-b border-border bg-card/40 backdrop-blur-sm rounded-t-xl px-2">
        {[
          { id: 'cells', label: 'Células', icon: Boxes },
          { id: 'machines', label: 'Máquinas / Postos', icon: Factory },
          { id: 'goals', label: 'Metas Produtivas', icon: Target },
          { id: 'links', label: 'Vínculos', icon: Users }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2.5 px-4 py-3 text-sm font-semibold border-b-2 transition-all duration-200 select-none",
                activeTab === tab.id
                  ? "border-primary text-primary font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo das Abas */}
      <div className="mt-2">
        {/* ABA CÉLULAS */}
        {activeTab === 'cells' && (
          <div className="space-y-4">
            {/* Barra de Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4.5 h-4.5 text-muted-foreground absolute left-3 top-2.5" />
                <Input
                  value={cellSearch}
                  onChange={(e) => setCellSearch(e.target.value)}
                  placeholder="Pesquisar células por nome ou descrição..."
                  className="pl-9 h-10 rounded-xl border-border/60 bg-card"
                />
              </div>
              <Select value={cellStatusFilter} onValueChange={setCellStatusFilter}>
                <SelectTrigger className="w-full sm:w-[160px] h-10 rounded-xl border-border/60 bg-card">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="active">Apenas Ativas</SelectItem>
                  <SelectItem value="inactive">Apenas Inativas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Listagem */}
            {cellsLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <RefreshCw className="w-7 h-7 animate-spin text-primary" />
                <span className="text-sm">Carregando células...</span>
              </div>
            ) : filteredCells.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border/80 bg-card/30 rounded-2xl text-sm flex flex-col items-center gap-2.5">
                <Boxes className="w-10 h-10 text-muted-foreground/50" />
                <p className="font-semibold text-foreground">Nenhuma célula encontrada</p>
                <p className="text-xs max-w-xs leading-relaxed">
                  Cadastre a primeira célula de trabalho ou limpe os filtros aplicados.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCells.map(c => {
                  const cellMachines = machines.filter(m => m.cell_name === c.name);
                  const cellGoal = goals.find(g => g.cell_name === c.name);

                  return (
                    <Card key={c.id} className={cn(
                      "p-5 border-border/60 flex flex-col justify-between transition-all duration-200 hover:shadow-md bg-card/65",
                      c.active === false && "opacity-60"
                    )}>
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-bold text-base truncate text-foreground">{c.name}</h3>
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">ID: {c.id.substring(0, 8)}...</p>
                          </div>
                          <Badge variant={c.active !== false ? "success" : "outline"} className="text-[10px] uppercase tracking-wider">
                            {c.active !== false ? 'Ativa' : 'Inativa'}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground mt-3 line-clamp-2 leading-relaxed min-h-[2.5rem]">
                          {c.description || 'Nenhuma descrição detalhada inserida.'}
                        </p>

                        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-3 gap-2">
                          <div className="text-center bg-secondary/50 p-2 rounded-xl">
                            <span className="text-[9px] text-muted-foreground font-bold block uppercase">Postos</span>
                            <span className="font-extrabold text-foreground text-sm">{cellMachines.length}</span>
                          </div>
                          <div className="text-center bg-secondary/50 p-2 rounded-xl col-span-2">
                            <span className="text-[9px] text-muted-foreground font-bold block uppercase">Horas por Turno</span>
                            <span className="font-semibold text-foreground text-xs font-mono">
                              {c.hoursShift1}h · {c.hoursShift2}h · {c.hoursShift3}h
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-border/30">
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={c.active !== false}
                            onCheckedChange={(checked) => mutationToggleCellActive.mutate({ id: c.id, active: checked })}
                          />
                          <span className="text-[10px] font-semibold text-muted-foreground">Ativa</span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground rounded-xl"
                            onClick={() => { setEditingCell(c); setCellDialogOpen(true); }}
                            title="Editar Célula"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl"
                            onClick={() => {
                              if (confirm(`Deseja realmente excluir a célula "${c.name}"? Isso pode impactar postos e metas associados.`)) {
                                mutationDeleteCell.mutate(c.id);
                              }
                            }}
                            title="Excluir Célula"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ABA MÁQUINAS/POSTOS */}
        {activeTab === 'machines' && (
          <div className="space-y-4">
            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4.5 h-4.5 text-muted-foreground absolute left-3 top-2.5" />
                <Input
                  value={machineSearch}
                  onChange={(e) => setMachineSearch(e.target.value)}
                  placeholder="Pesquisar máquina/posto por nome..."
                  className="pl-9 h-10 rounded-xl border-border/60 bg-card"
                />
              </div>
              <Select value={machineCellFilter} onValueChange={setMachineCellFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl border-border/60 bg-card">
                  <SelectValue placeholder="Célula" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">Todas as Células</SelectItem>
                  {activeCells.map(c => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Listagem */}
            {machinesLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <RefreshCw className="w-7 h-7 animate-spin text-primary" />
                <span className="text-sm">Carregando máquinas e postos...</span>
              </div>
            ) : filteredMachines.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border/80 bg-card/30 rounded-2xl text-sm flex flex-col items-center gap-2.5">
                <Factory className="w-10 h-10 text-muted-foreground/50" />
                <p className="font-semibold text-foreground">Nenhuma máquina/posto cadastrado</p>
                <p className="text-xs max-w-xs leading-relaxed">
                  Postos de trabalho auxiliam no detalhamento físico da bipagem e coleta no chão de fábrica.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMachines.map(m => (
                  <Card key={m.id} className={cn(
                    "p-5 border-border/60 flex flex-col justify-between transition-all duration-200 hover:shadow-md bg-card/65",
                    m.active === false && "opacity-60"
                  )}>
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-bold text-base truncate text-foreground">{m.name}</h3>
                          <p className="text-xs text-muted-foreground font-medium mt-1">Célula: {m.cell_name}</p>
                        </div>
                        <Badge variant={m.active !== false ? "success" : "outline"} className="text-[10px] uppercase tracking-wider">
                          {m.active !== false ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </div>

                      <div className="mt-4 space-y-2">
                        {m.station_name && (
                          <p className="text-xs text-muted-foreground">
                            Código do Posto: <span className="font-semibold text-foreground">{m.station_name}</span>
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Unidade Métrica: <span className="font-semibold text-foreground capitalize">{m.metric_unit || 'peças'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-border/30">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={m.active !== false}
                          onCheckedChange={(checked) => mutationToggleMachineActive.mutate({
                            id: m.id,
                            active: checked,
                            name: m.name,
                            cell_name: m.cell_name,
                            station_name: m.station_name,
                            metric_unit: m.metric_unit
                          })}
                        />
                        <span className="text-[10px] font-semibold text-muted-foreground">Ativa</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground rounded-xl"
                          onClick={() => openEditMachineDialog(m)}
                          title="Editar Posto"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl"
                          onClick={() => {
                            if (confirm(`Deseja realmente excluir a máquina/posto "${m.name}"?`)) {
                              mutationDeleteMachine.mutate(m.id);
                            }
                          }}
                          title="Excluir Posto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ABA METAS */}
        {activeTab === 'goals' && (
          <div className="space-y-6">
            {/* Seletor de Data */}
            <div className="flex items-center gap-2 flex-wrap bg-card p-3 rounded-2xl border border-border/50 shadow-sm w-fit">
              <Button variant="outline" size="icon" className="rounded-xl h-8 w-8" onClick={() => navigateDate(-1)}>
                <ChevronLeft className="w-4.5 h-4.5" />
              </Button>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto rounded-xl text-sm h-8 border-border/60 bg-transparent font-medium"
              />
              <span className="text-xs text-muted-foreground font-semibold px-2 capitalize hidden sm:inline">{formattedDate}</span>
              <Button variant="outline" size="icon" className="rounded-xl h-8 w-8" onClick={() => navigateDate(1)}>
                <ChevronRight className="w-4.5 h-4.5" />
              </Button>
              {date !== todayStr() && (
                <Button variant="ghost" size="sm" className="text-[10px] h-8 font-bold uppercase" onClick={() => setDate(todayStr())}>
                  Hoje
                </Button>
              )}
            </div>

            {/* Editor de Metas Diárias */}
            <DailyGoalEditor date={date} activeCells={activeCells} onSaved={refetchGoals} />

            {/* Metas Ativas Cadastradas */}
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/40">
              <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4.5 h-4.5 text-primary animate-pulse" />
                  <h3 className="font-bold text-sm text-foreground">Metas Diárias Configuradas ({goals.length})</h3>
                </div>
              </div>
              <div className="p-5">
                {goalsLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                    <span className="text-xs">Carregando metas...</span>
                  </div>
                ) : goals.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-xs border border-dashed border-border rounded-xl">
                    Nenhuma meta configurada para a data selecionada. Cadastre metas acima para alimentar os gráficos.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {goals.map((g) => {
                      const pct = g.capacity > 0 ? Math.round((g.target / g.capacity) * 100) : null;
                      return (
                        <Card key={g.id} className="p-4 flex items-center justify-between border-border/50 bg-card shadow-sm hover:shadow transition-shadow">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-foreground truncate">{g.cell_name || g.area_name}</span>
                              <Badge variant="secondary" className="text-[9px] font-bold uppercase tracking-wider">{g.shift}</Badge>
                              {pct !== null && (
                                <Badge className={`text-[9px] font-semibold ${
                                  pct >= 100 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : pct >= 80 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                }`}>
                                  {pct}% da cap.
                                </Badge>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                              <span>Meta:</span>
                              <span className="font-extrabold text-foreground">{Number(g.target).toLocaleString('pt-BR')} {g.metric_unit_label || g.metric_unit}</span>
                              {g.capacity > 0 && (
                                <>
                                  <span>·</span>
                                  <span>Cap: {Number(g.capacity).toLocaleString('pt-BR')}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl"
                            onClick={() => mutationDeleteGoal.mutate(g.id)}
                            title="Remover Meta"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>

            {/* Metas Mensais */}
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/40">
              <div className="px-5 py-4 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <CalendarRange className="w-4.5 h-4.5 text-primary" />
                  <h3 className="font-bold text-sm text-foreground">Metas e Capacidades Mensais</h3>
                </div>
              </div>
              <div className="p-5">
                <MonthlyGoalsManager />
              </div>
            </Card>
          </div>
        )}

        {/* ABA VÍNCULOS */}
        {activeTab === 'links' && (
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="font-bold text-sm">Gerenciamento de Operadores e Turnos</p>
                <p className="text-xs opacity-90 leading-relaxed">
                  Para alterar as células vinculadas ou remanejar o turno de um operador, utilize o painel de Usuários do Sistema.
                </p>
              </div>
              <Button asChild className="rounded-xl shadow-sm text-xs bg-amber-500 hover:bg-amber-600 text-white shrink-0 self-start sm:self-auto gap-2">
                <Link to="/usuarios?tab=operators">
                  <ExternalLink className="w-3.5 h-3.5" /> Acessar Operadores
                </Link>
              </Button>
            </div>

            {/* Listagem de Operadores por Célula */}
            {operatorsLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <RefreshCw className="w-7 h-7 animate-spin text-primary" />
                <span className="text-sm">Carregando operadores...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Object.entries(operatorsByCell).map(([cellName, ops]) => {
                  if (ops.length === 0 && cellName === 'Outros') return null;

                  return (
                    <Card key={cellName} className="border-border/60 shadow-sm bg-card/45 overflow-hidden">
                      <div className="px-4.5 py-3 border-b border-border/50 bg-secondary/30 flex items-center justify-between">
                        <span className="font-bold text-xs text-foreground block uppercase tracking-wide">{cellName}</span>
                        <Badge variant="outline" className="text-[10px] font-bold">{ops.length} Operador{ops.length !== 1 && 'es'}</Badge>
                      </div>
                      <div className="p-4 space-y-3">
                        {ops.length === 0 ? (
                          <span className="text-xs text-muted-foreground block text-center py-6">Nenhum operador vinculado a esta célula.</span>
                        ) : (
                          ops.map(op => (
                            <div key={op.id} className="flex items-center justify-between bg-card border border-border/40 p-3 rounded-xl">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-foreground truncate">{op.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Reg: {op.registration || 'N/A'} · {op.shift || 'Sem Turno'}</p>
                              </div>
                              <Badge className="text-[9px] font-bold bg-[#76FB91]/25 text-[#1b5e20] dark:bg-[#76FB91]/15 dark:text-[#76FB91] border border-[#76FB91]/35">
                                {op.shift || 'Geral'}
                              </Badge>
                            </div>
                          ))
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* DIÁLOGO MODAL: CADASTRAR/EDITAR CÉLULA */}
      <Dialog open={cellDialogOpen} onOpenChange={setCellDialogOpen}>
        <DialogContent className="sm:max-w-[520px] rounded-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-bold text-foreground">{editingCell ? 'Editar Célula Produtiva' : 'Cadastrar Nova Célula'}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure o nome, notas e o número de horas estimadas por turno de trabalho para esta linha produtiva.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-3">
            <CellForm
              onSubmit={handleCellSubmit}
              saving={cellSaving}
              editing={editingCell}
              onCancel={() => { setEditingCell(null); setCellDialogOpen(false); }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO MODAL: CADASTRAR/EDITAR MÁQUINA/POSTO */}
      <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-bold text-foreground">{editingMachine ? 'Editar Máquina/Posto' : 'Cadastrar Nova Máquina/Posto'}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Postos de trabalho e coletores físicos são associados a uma célula de produção para fins de auditoria MES.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleMachineSubmit} className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-cell" className="text-xs font-bold text-foreground">Célula Vinculada</Label>
              <Select value={mCell} onValueChange={setMCell}>
                <SelectTrigger id="m-cell" className="rounded-xl border-border/60 bg-transparent h-10 text-sm">
                  <SelectValue placeholder="Selecione a célula" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {activeCells.map(c => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-name" className="text-xs font-bold text-foreground">Nome da Máquina/Posto</Label>
              <Input
                id="m-name"
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                placeholder="Ex: Serra Seccionadora 02, Mesa Embalagem 01"
                className="rounded-xl border-border/60 h-10 text-sm bg-transparent"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="m-station" className="text-xs font-bold text-foreground">Código/Station (Opcional)</Label>
                <Input
                  id="m-station"
                  value={mStation}
                  onChange={(e) => setMStation(e.target.value)}
                  placeholder="Ex: Station-01"
                  className="rounded-xl border-border/60 h-10 text-sm bg-transparent"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-unit" className="text-xs font-bold text-foreground">Unidade Métrica</Label>
                <Select value={mUnit} onValueChange={setMUnit}>
                  <SelectTrigger id="m-unit" className="rounded-xl border-border/60 bg-transparent h-10 text-sm">
                    <SelectValue placeholder="Ex: peças" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="peças">Peças</SelectItem>
                    <SelectItem value="volumes">Volumes</SelectItem>
                    <SelectItem value="metros">Metros Lineares</SelectItem>
                    <SelectItem value="chapas">Chapas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-secondary/20">
              <div className="space-y-0.5">
                <Label htmlFor="m-active" className="text-xs font-bold text-foreground block">Status Ativo</Label>
                <span className="text-[10px] text-muted-foreground">Postos inativos não aparecem na tela de Coleta/Bipagem.</span>
              </div>
              <Switch id="m-active" checked={mActive} onCheckedChange={setMActive} />
            </div>

            <div className="flex justify-end gap-2.5 pt-4 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl text-xs h-9 font-semibold"
                onClick={() => setMachineDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={machineSaving}
                className="rounded-xl text-xs h-9 font-bold bg-primary text-primary-foreground hover:bg-primary/95"
              >
                {machineSaving ? 'Salvando...' : 'Salvar Posto'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

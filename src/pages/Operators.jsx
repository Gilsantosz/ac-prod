import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  HardHat, Plus, Edit2, CheckCircle, XCircle, Unlock,
  Search, History, MapPin, Cpu, Clock, RefreshCw, KeyRound
} from 'lucide-react';

import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useCells } from '@/hooks/useCells';
import { fetchProductionMachines } from '@/lib/traceabilityService';
import {
  fetchOperators,
  createOperator,
  updateOperator,
  unlockOperator,
  fetchAccessAttempts
} from '@/lib/operatorAdminService';

export default function Operators() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modais
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyLoginName, setHistoryLoginName] = useState(null);

  // Queries
  const { data: operators = [], isLoading: loadingOperators, refetch: refetchOperators } = useQuery({
    queryKey: ['operators-admin-list'],
    queryFn: fetchOperators,
    initialData: []
  });

  const { activeCells = [] } = useCells();

  // Buscar todas as máquinas de todas as células para poder associar
  const { data: allMachines = [] } = useQuery({
    queryKey: ['all-machines-admin'],
    queryFn: () => fetchProductionMachines(null),
    initialData: []
  });

  // Mutações
  const createMut = useMutation({
    mutationFn: createOperator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators-admin-list'] });
      toast.success('Operador cadastrado com sucesso!');
      setFormModalOpen(false);
    },
    onError: (err) => toast.error(err.message || 'Erro ao cadastrar operador')
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateOperator(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators-admin-list'] });
      toast.success('Operador atualizado com sucesso!');
      setFormModalOpen(false);
    },
    onError: (err) => toast.error(err.message || 'Erro ao atualizar operador')
  });

  const toggleStatusMut = useMutation({
    mutationFn: ({ id, data }) => updateOperator(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators-admin-list'] });
      toast.success('Status do operador atualizado!');
    },
    onError: (err) => toast.error(err.message || 'Erro ao alterar status')
  });

  const unlockMut = useMutation({
    mutationFn: unlockOperator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators-admin-list'] });
      toast.success('Operador desbloqueado com sucesso!');
    },
    onError: (err) => toast.error(err.message || 'Erro ao desbloquear operador')
  });

  // Filtragem de operadores local
  const filteredOperators = operators.filter(op => {
    const term = searchTerm.toLowerCase();
    return (
      op.name?.toLowerCase().includes(term) ||
      op.login_name?.toLowerCase().includes(term) ||
      op.registration_normalized?.toLowerCase().includes(term)
    );
  });

  const handleEditClick = (op) => {
    setSelectedOperator(op);
    setFormModalOpen(true);
  };

  const handleCreateClick = () => {
    setSelectedOperator(null);
    setFormModalOpen(true);
  };

  const handleToggleActive = (op) => {
    toggleStatusMut.mutate({
      id: op.id,
      data: {
        ...op,
        active: !op.active,
        cell_ids: op.cell_assignments?.filter(ca => ca.active).map(ca => ca.cell_id) || [],
        machine_ids: op.machine_assignments?.filter(ma => ma.active).map(ma => ma.machine_id) || [],
        primary_cell_id: op.primary_cell_id,
        primary_machine_id: op.primary_machine_id
      }
    });
  };

  const handleUnlock = (op) => {
    unlockMut.mutate(op.id);
  };

  const handleViewAttempts = (loginName) => {
    setHistoryLoginName(loginName);
    setHistoryModalOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Gestão de Operadores"
        subtitle="Cadastro de operadores do chão de fábrica, controle de matrículas, vínculos com postos de trabalho e histórico de acessos."
        icon={HardHat}
      />

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        {/* Barra de busca */}
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, login ou matrícula..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-10 rounded-xl"
          />
        </div>

        {/* Botões de Ação */}
        <div className="flex gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={() => refetchOperators()}
            disabled={loadingOperators}
            className="h-10 rounded-xl gap-2 text-xs font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOperators ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            onClick={handleCreateClick}
            className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 text-xs flex-1 sm:flex-none"
          >
            <Plus className="w-4 h-4" /> Novo Operador
          </Button>
        </div>
      </div>

      {loadingOperators ? (
        <div className="text-center py-20 text-muted-foreground">Carregando operadores...</div>
      ) : filteredOperators.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground border-border/60">
          <HardHat className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Nenhum operador encontrado</h3>
          <p className="text-sm">Cadastre um novo operador para iniciar.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredOperators.map(op => {
            const isLocked = op.locked_until && new Date(op.locked_until) > new Date();
            const activeCellsCount = op.cell_assignments?.filter(ca => ca.active).length || 0;
            const activeMachinesCount = op.machine_assignments?.filter(ma => ma.active).length || 0;

            return (
              <Card 
                key={op.id} 
                className={`p-5 border-border/60 shadow-sm flex flex-col justify-between transition-all duration-200 hover:shadow-md ${
                  !op.active ? 'opacity-60 bg-muted/20' : ''
                }`}
              >
                <div className="space-y-4">
                  {/* Cabeçalho */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-bold text-foreground truncate max-w-[200px]">{op.name}</h4>
                      <p className="text-xs text-muted-foreground font-mono">@{op.login_name}</p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {isLocked ? (
                        <Badge variant="destructive" className="gap-1 text-[10px] font-bold">
                          Bloqueado
                        </Badge>
                      ) : op.active ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/20 text-[10px] font-bold">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-bold">
                          Inativo
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Informações */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-medium text-muted-foreground border-t border-border/40 pt-3">
                    <div className="flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-muted-foreground/75" />
                      <span>PIN: {op.registration_normalized ? '***' + op.registration_normalized.slice(-2) : 'Não conf.'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground/75" />
                      <span>{op.shift || 'Sem Turno'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 col-span-2">
                      <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="truncate">Célula Principal: <strong>{op.primary_cell?.name || 'Nenhuma'}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5 col-span-2">
                      <Cpu className="w-3.5 h-3.5 text-blue-500" />
                      <span className="truncate">Máquina Principal: <strong>{op.primary_machine?.name || 'Nenhuma'}</strong></span>
                    </div>
                  </div>

                  {/* Vínculos */}
                  <div className="flex gap-2 text-[11px] font-semibold text-muted-foreground">
                    <span className="bg-secondary/40 px-2 py-0.5 rounded-md">
                      {activeCellsCount} Célula(s)
                    </span>
                    <span className="bg-secondary/40 px-2 py-0.5 rounded-md">
                      {activeMachinesCount} Máquina(s)
                    </span>
                  </div>
                  {activeCellsCount === 0 && (
                    <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      Sem célula vinculada — edite o operador para liberar o acesso à coleta.
                    </p>
                  )}
                </div>

                {/* Botões de Ação */}
                <div className="flex items-center gap-2 border-t border-border/40 pt-4 mt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditClick(op)}
                    className="h-8 rounded-lg text-xs font-bold gap-1 px-2.5 flex-1"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewAttempts(op.login_name)}
                    className="h-8 rounded-lg text-xs font-bold gap-1 px-2.5 flex-1"
                  >
                    <History className="w-3.5 h-3.5" /> Acessos
                  </Button>
                  {isLocked && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnlock(op)}
                      className="h-8 rounded-lg text-xs font-bold gap-1 px-2.5 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/5"
                    >
                      <Unlock className="w-3.5 h-3.5" /> Desbloquear
                    </Button>
                  )}
                  <Button
                    variant={op.active ? 'ghost' : 'outline'}
                    size="sm"
                    onClick={() => handleToggleActive(op)}
                    className={`h-8 rounded-lg text-xs font-bold px-2 ${
                      op.active ? 'text-rose-500 hover:bg-rose-500/10' : 'text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/10'
                    }`}
                  >
                    {op.active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Formulário (Add/Edit) */}
      {formModalOpen && (
        <OperatorFormModal
          operator={selectedOperator}
          activeCells={activeCells}
          allMachines={allMachines}
          onClose={() => setFormModalOpen(false)}
          onSubmit={(data) => {
            if (selectedOperator) {
              updateMut.mutate({ id: selectedOperator.id, data });
            } else {
              createMut.mutate(data);
            }
          }}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      {/* Modal de Histórico de Acessos */}
      {historyModalOpen && (
        <AccessAttemptsModal
          loginName={historyLoginName}
          onClose={() => setHistoryModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Componente: Form Modal de Operador ────────────────────────
function OperatorFormModal({ operator, activeCells, allMachines, onClose, onSubmit, loading }) {
  const [name, setName] = useState(operator?.name || '');
  const [loginName, setLoginName] = useState(operator?.login_name || '');
  const [registration, setRegistration] = useState('');
  const [shift, setShift] = useState(operator?.shift || '1º Turno');
  
  // Célula / Máquina Principal
  const [primaryCellId, setPrimaryCellId] = useState(operator?.primary_cell_id || '');
  const [primaryMachineId, setPrimaryMachineId] = useState(operator?.primary_machine_id || '');

  // Vínculos Autorizados
  const [cellIds, setCellIds] = useState(() => 
    operator?.cell_assignments?.filter(ca => ca.active).map(ca => ca.cell_id) || []
  );
  const [machineIds, setMachineIds] = useState(() => 
    operator?.machine_assignments?.filter(ma => ma.active).map(ma => ma.machine_id) || []
  );

  // Filtrar máquinas para a célula principal
  const primaryMachines = allMachines.filter(m => m.cell_id === primaryCellId);

  // Filtrar máquinas disponíveis com base nas células vinculadas
  const availableMachines = allMachines.filter(m => cellIds.includes(m.cell_id));

  // Ao selecionar uma célula principal, adicioná-la às células autorizadas e limpar máquina se inconsistente
  const handlePrimaryCellChange = (val) => {
    setPrimaryCellId(val);
    setPrimaryMachineId('');
    if (val && !cellIds.includes(val)) {
      setCellIds(prev => [...prev, val]);
    }
  };

  const handleCellToggle = (cellId) => {
    setCellIds(prev => {
      const active = prev.includes(cellId);
      if (active) {
        // Se remover a célula principal, limpar célula principal
        if (cellId === primaryCellId) {
          setPrimaryCellId('');
          setPrimaryMachineId('');
        }
        // Limpar máquinas ligadas a esta célula
        const machsOfCell = allMachines.filter(m => m.cell_id === cellId).map(m => m.id);
        setMachineIds(mPrev => mPrev.filter(id => !machsOfCell.includes(id)));
        return prev.filter(id => id !== cellId);
      } else {
        return [...prev, cellId];
      }
    });
  };

  const handleMachineToggle = (machId, machCellId) => {
    // Garante que a célula está marcada se a máquina for marcada
    if (!cellIds.includes(machCellId)) {
      setCellIds(prev => [...prev, machCellId]);
    }

    setMachineIds(prev => {
      if (prev.includes(machId)) {
        if (machId === primaryMachineId) setPrimaryMachineId('');
        return prev.filter(id => id !== machId);
      } else {
        return [...prev, machId];
      }
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.warning('Informe o nome.');
    if (!loginName.trim()) return toast.warning('Informe o login.');
    if (!operator && !registration.trim()) return toast.warning('Informe a matrícula.');
    if (!primaryCellId) return toast.warning('Selecione a célula principal do operador.');
    if (!cellIds.includes(primaryCellId)) return toast.warning('A célula principal deve estar entre as células autorizadas.');

    // Validar login_name format (alfanumérico e ponto apenas)
    const loginNormalized = loginName.toLowerCase().trim().replace(/\s+/g, '.');
    if (!/^[a-z0-9.]+$/.test(loginNormalized)) {
      return toast.warning('O login do operador deve conter apenas letras, números e pontos.');
    }

    onSubmit({
      name: name.trim(),
      login_name: loginNormalized,
      registration: registration.trim(),
      shift,
      primary_cell_id: primaryCellId || null,
      primary_machine_id: primaryMachineId || null,
      cell_ids: cellIds,
      machine_ids: machineIds,
      active: operator ? operator.active : true
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl bg-card border-border/80 rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-border/40 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <HardHat className="w-5 h-5 text-emerald-600" />
            {operator ? 'Editar Operador' : 'Novo Operador'}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm font-semibold">
            Fechar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Dados Pessoais */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="form-op-name" className="text-xs font-bold text-muted-foreground">Nome Completo</Label>
              <Input
                id="form-op-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: João Silva"
                required
                className="rounded-xl h-10 bg-background/50 focus:bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="form-op-login" className="text-xs font-bold text-muted-foreground">Login Único</Label>
              <Input
                id="form-op-login"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="Ex: joao.silva"
                required
                className="rounded-xl h-10 bg-background/50 focus:bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="form-op-reg" className="text-xs font-bold text-muted-foreground">
                Matrícula (Senha) {operator && <span className="text-[10px] text-muted-foreground font-normal">(deixe em branco para manter a atual)</span>}
              </Label>
              <Input
                id="form-op-reg"
                type="password"
                value={registration}
                onChange={(e) => setRegistration(e.target.value)}
                placeholder={operator ? "Mantendo a senha atual" : "Ex: 00123"}
                required={!operator}
                className="rounded-xl h-10 bg-background/50 focus:bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="form-op-shift" className="text-xs font-bold text-muted-foreground">Turno Padrão</Label>
              <select
                id="form-op-shift"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                className="w-full h-10 rounded-xl border border-input bg-background/50 focus:bg-background px-3 text-sm font-medium"
              >
                {['1º Turno', '2º Turno', '3º Turno'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <hr className="border-border/40" />

          {/* Células e Máquinas Principais */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="form-primary-cell" className="text-xs font-bold text-muted-foreground">Célula Principal</Label>
              <select
                id="form-primary-cell"
                value={primaryCellId}
                onChange={(e) => handlePrimaryCellChange(e.target.value)}
                className="w-full h-10 rounded-xl border border-input bg-background/50 focus:bg-background px-3 text-sm font-medium"
              >
                <option value="">Selecione a célula</option>
                {activeCells.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="form-primary-machine" className="text-xs font-bold text-muted-foreground">Máquina Principal</Label>
              <select
                id="form-primary-machine"
                value={primaryMachineId}
                onChange={(e) => {
                  setPrimaryMachineId(e.target.value);
                  // Garante que a máquina principal está nas autorizadas
                  if (e.target.value && !machineIds.includes(e.target.value)) {
                    setMachineIds(prev => [...prev, e.target.value]);
                  }
                }}
                disabled={!primaryCellId}
                className="w-full h-10 rounded-xl border border-input bg-background/50 focus:bg-background px-3 text-sm font-medium disabled:opacity-50"
              >
                <option value="">Nenhuma</option>
                {primaryMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <hr className="border-border/40" />

          {/* Permissões de Postos: Células e Máquinas Autorizadas */}
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Acesso e Postos Autorizados</h4>
              <p className="text-[11px] text-muted-foreground">Selecione as células autorizadas. Se nenhuma máquina for marcada, o operador poderá usar qualquer máquina ativa dessas células.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {/* Células */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-foreground">Células de Trabalho</Label>
                <div className="border border-border/60 rounded-xl p-3 bg-secondary/10 space-y-2 max-h-48 overflow-y-auto">
                  {activeCells.map(cell => (
                    <label key={cell.id} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cellIds.includes(cell.id)}
                        onChange={() => handleCellToggle(cell.id)}
                        className="rounded border-input text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                      />
                      <span>{cell.name}</span>
                      {cell.id === primaryCellId && <Badge variant="secondary" className="text-[9px] scale-90 py-0 px-1 font-bold">Principal</Badge>}
                    </label>
                  ))}
                </div>
              </div>

              {/* Máquinas */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-foreground">Máquinas / Postos de Trabalho</Label>
                <div className="border border-border/60 rounded-xl p-3 bg-secondary/10 space-y-2 max-h-48 overflow-y-auto">
                  {availableMachines.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-2 text-center">Selecione uma célula para ver as máquinas.</p>
                  ) : (
                    availableMachines.map(mach => (
                      <label key={mach.id} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={machineIds.includes(mach.id)}
                          onChange={() => handleMachineToggle(mach.id, mach.cell_id)}
                          className="rounded border-input text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                        />
                        <span className="truncate">{mach.name}</span>
                        {mach.id === primaryMachineId && <Badge variant="secondary" className="text-[9px] scale-90 py-0 px-1 font-bold">Principal</Badge>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-border/40 flex justify-end gap-2 shrink-0 bg-secondary/10">
          <Button variant="ghost" onClick={onClose} disabled={loading} className="rounded-xl h-10 font-semibold text-xs">
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="rounded-xl h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
            {loading ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Componente: AccessAttemptsModal ─────────────────────────
function AccessAttemptsModal({ loginName, onClose }) {
  const { data: attempts = [], isLoading, refetch } = useQuery({
    queryKey: ['access-attempts', loginName],
    queryFn: () => fetchAccessAttempts(loginName),
    initialData: []
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <Card className="w-full max-w-3xl bg-card border-border/80 rounded-2xl shadow-xl max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-border/40 flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Histórico de Tentativas de Acesso
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Mostrando as últimas 100 tentativas para <strong>{loginName ? `@${loginName}` : 'todos'}</strong></p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 rounded-lg text-xs font-semibold gap-1">
              <RefreshCw className="w-3 h-3" /> Atualizar
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 rounded-lg text-xs font-semibold">
              Fechar
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground">Buscando auditoria de acessos...</div>
          ) : attempts.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">Nenhuma tentativa de acesso registrada para este operador.</div>
          ) : (
            <div className="border border-border/60 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/40 font-semibold border-b border-border/60 text-muted-foreground">
                    <th className="p-3">Data/Hora</th>
                    <th className="p-3">Login Digitado</th>
                    <th className="p-3">Resultado</th>
                    <th className="p-3">Motivo da Falha</th>
                    <th className="p-3">IP / Dispositivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-medium">
                  {attempts.map(att => (
                    <tr key={att.id}>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {new Date(att.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="p-3 font-mono">@{att.login_name_input}</td>
                      <td className="p-3">
                        {att.success ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/10 font-bold gap-1 scale-95 py-0">
                            <CheckCircle className="w-3 h-3" /> Sucesso
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="font-bold gap-1 scale-95 py-0">
                            <XCircle className="w-3 h-3" /> Falha
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-rose-500">
                        {att.failure_reason === 'invalid_credentials' && 'Senha/Matrícula Inválida'}
                        {att.failure_reason === 'operator_not_found_or_inactive' && 'Operador não cadastrado/inativo'}
                        {att.failure_reason === 'locked_until_active' && 'Conta bloqueada temporariamente'}
                        {att.failure_reason === 'rate_limit_locked' && 'Rate-Limit Bloqueado (Múltiplas Tentativas)'}
                        {!att.success && !att.failure_reason && 'Erro Desconhecido'}
                        {att.success && <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[150px] truncate" title={att.device_id}>
                        {att.device_id || 'Browser / N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

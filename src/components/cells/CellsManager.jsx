import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import CellForm from '@/components/cells/CellForm';
import CellList from '@/components/cells/CellList';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { ToggleLeft, ToggleRight, Trash2, Plus, PenTool } from 'lucide-react';

export default function CellsManager() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('cells');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  // Estados do cadastro de máquina
  const [mName, setMName] = useState('');
  const [mCell, setMCell] = useState('');
  const [mStation, setMStation] = useState('');
  const [mUnit, setMUnit] = useState('peças');
  const [mSaving, setMSaving] = useState(false);

  const { data: cells = [] } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('-created_date', 200),
    initialData: [],
  });

  // Query das máquinas via Supabase
  const { data: machines = [], refetch: refetchMachines } = useQuery({
    queryKey: ['production-machines-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_machines')
        .select('*')
        .order('cell_name')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    initialData: [],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['cells'] });

  const create = useMutation({
    mutationFn: (payload) => base44.entities.Cell.create(payload),
    onSuccess: () => { invalidate(); toast.success('Célula cadastrada'); },
    onError: () => toast.error('Falha ao cadastrar célula'),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.Cell.update(id, payload),
    onSuccess: () => { invalidate(); toast.success('Célula atualizada'); setEditing(null); },
    onError: () => toast.error('Falha ao atualizar célula'),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.Cell.delete(id),
    onSuccess: () => { invalidate(); toast.success('Célula removida'); },
  });

  // Mutações da Máquina
  const addMachine = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase
        .from('production_machines')
        .insert([payload]);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refetchMachines();
      toast.success('Máquina cadastrada com sucesso');
      setMName('');
      setMStation('');
    },
    onError: (err) => {
      toast.error(`Erro ao cadastrar máquina: ${err.message}`);
    }
  });

  const toggleMachineActive = useMutation({
    mutationFn: async ({ id, active }) => {
      const { error } = await supabase
        .from('production_machines')
        .update({ active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchMachines();
      toast.success('Status da máquina atualizado');
    }
  });

  const deleteMachine = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('production_machines')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchMachines();
      toast.success('Máquina excluída');
    },
    onError: (err) => {
      toast.error(`Erro ao excluir: ${err.message}`);
    }
  });

  const handleSubmit = async (payload) => {
    setSaving(true);
    if (editing) await update.mutateAsync({ id: editing.id, payload });
    else await create.mutateAsync(payload);
    setSaving(false);
  };

  const handleMachineSubmit = async (e) => {
    e.preventDefault();
    if (!mName || !mCell) {
      toast.error('Informe o nome da máquina e a célula correspondente.');
      return;
    }
    setMSaving(true);
    await addMachine.mutateAsync({
      name: mName,
      cell_name: mCell,
      station_name: mStation || null,
      metric_unit: mUnit || 'peças',
      active: true
    });
    setMSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Abas */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('cells')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'cells'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Gestão de Células
        </button>
        <button
          onClick={() => setActiveTab('machines')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'machines'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Máquinas / Postos por Célula
        </button>
      </div>

      {activeTab === 'cells' ? (
        <div className="space-y-6">
          <CellForm onSubmit={handleSubmit} saving={saving} editing={editing} onCancel={() => setEditing(null)} />
          <CellList cells={cells} onEdit={setEditing} onDelete={(id) => remove.mutate(id)} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Formulário de Máquinas */}
          <form onSubmit={handleMachineSubmit} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <PenTool className="w-5 h-5" /> Cadastrar Nova Máquina / Posto
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="machine-name" className="text-xs font-semibold text-muted-foreground">Nome da Máquina *</label>
                <input
                  id="machine-name"
                  type="text"
                  placeholder="Ex: Coladeira 01"
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="machine-cell" className="text-xs font-semibold text-muted-foreground">Célula Correspondente *</label>
                <select
                  id="machine-cell"
                  value={mCell}
                  onChange={(e) => setMCell(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-medium"
                  required
                >
                  <option value="">Selecione a célula</option>
                  {cells.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="machine-station" className="text-xs font-semibold text-muted-foreground">Posto / Estação (Opcional)</label>
                <input
                  id="machine-station"
                  type="text"
                  placeholder="Ex: Station A"
                  value={mStation}
                  onChange={(e) => setMStation(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="machine-unit" className="text-xs font-semibold text-muted-foreground">Unidade Métrica</label>
                <select
                  id="machine-unit"
                  value={mUnit}
                  onChange={(e) => setMUnit(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-medium"
                >
                  <option value="peças">peças</option>
                  <option value="m²">m²</option>
                  <option value="m">m</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={mSaving} className="gap-2">
                <Plus className="w-4 h-4" /> {mSaving ? 'Cadastrando...' : 'Adicionar Máquina'}
              </Button>
            </div>
          </form>

          {/* Lista de Máquinas */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Máquinas Cadastradas ({machines.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/40 text-muted-foreground text-xs uppercase font-semibold">
                  <tr>
                    <th className="px-4 py-3">Máquina / Posto</th>
                    <th className="px-4 py-3">Célula</th>
                    <th className="px-4 py-3">Estação</th>
                    <th className="px-4 py-3">Medida</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {machines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhuma máquina cadastrada.
                      </td>
                    </tr>
                  ) : (
                    machines.map((m) => (
                      <tr key={m.id} className="hover:bg-secondary/20">
                        <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                        <td className="px-4 py-3">{m.cell_name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{m.station_name || '-'}</td>
                        <td className="px-4 py-3">{m.metric_unit || 'peças'}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleMachineActive.mutate({ id: m.id, active: !m.active })}
                            className="inline-flex focus:outline-none"
                          >
                            {m.active ? (
                              <ToggleRight className="w-7 h-7 text-emerald-500" />
                            ) : (
                              <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Deseja realmente remover a máquina "${m.name}"?`)) {
                                deleteMachine.mutate(m.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
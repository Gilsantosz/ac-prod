import { useState, useEffect } from 'react';
import { Sliders, ShieldCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  getEnabledWorkstations,
  grantOperatorWorkstationAuthorization
} from '@/lib/replacementService';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

export default function WorkstationConfigModal({ open, onOpenChange }) {
  const [workstations, setWorkstations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Form Novo Vínculo de Autorização
  const [newOpId, setNewOpId] = useState('');
  const [newShift, setNewShift] = useState('1');
  const [newAuthType, setNewAuthType] = useState('permanent');

  // Carregar Postos e Operadores
  useEffect(() => {
    if (!open) return;
    async function loadData() {
      setIsLoading(true);
      try {
        const wsList = await getEnabledWorkstations();
        setWorkstations(wsList);
        if (wsList.length > 0 && !selectedMachineId) {
          setSelectedMachineId(wsList[0].id);
        }

        const { data: opData } = await supabase
          .from('operators')
          .select('id, name, registration, active')
          .eq('active', true)
          .order('name');
        setOperators(opData || []);
      } catch (err) {
        console.error('Erro ao carregar configurações de postos:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [open]);

  // Alternar permissão de reposição no posto
  const handleToggleReplacement = async (machineId, currentVal) => {
    try {
      const { error } = await supabase
        .from('production_machines')
        .update({ allows_replacement: !currentVal, updated_at: new Date().toISOString() })
        .eq('id', machineId);

      if (error) throw error;
      setWorkstations(prev => prev.map(w => w.id === machineId ? { ...w, allows_replacement: !currentVal } : w));
      toast.success('Configuração do posto atualizada com sucesso.');
    } catch (err) {
      console.error('Erro ao atualizar posto:', err);
      toast.error('Falha ao atualizar permissão do posto.');
    }
  };

  // Conceder autorização a operador
  const handleAddAuthorization = async (e) => {
    e.preventDefault();
    if (!newOpId || !selectedMachineId) {
      toast.error('Selecione o operador e o posto.');
      return;
    }

    try {
      await grantOperatorWorkstationAuthorization({
        operatorId: newOpId,
        machineId: selectedMachineId,
        shift: newShift,
        authorizationType: newAuthType
      });
      toast.success('Autorização concedida ao operador.');
      setNewOpId('');
    } catch (err) {
      console.error('Erro ao conceder autorização:', err);
      toast.error(err.message || 'Falha ao conceder autorização.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Sliders className="w-5 h-5 text-amber-500" />
            Configuração de Postos Habilitados para Reposição
          </DialogTitle>
          <DialogDescription className="text-xs">
            Habilite os postos da fábrica autorizados a receber baixas de reposição e vincule os operadores.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Carregando postos e operadores...</div>
        ) : (
          <div className="space-y-6 py-2">
            {/* Lista de Postos Habilitados */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Postos de Trabalho Cadastrados
              </h3>
              <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
                {workstations.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">Nenhum posto cadastrado.</div>
                ) : (
                  workstations.map(w => (
                    <div key={w.id} className="p-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{w.name}</span>
                          <Badge variant="outline" className="text-[10px] bg-slate-500/10">
                            {w.cell_name}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {w.description || 'Sem descrição adicional'}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant={w.allows_replacement !== false ? 'default' : 'outline'}
                          onClick={() => handleToggleReplacement(w.id, w.allows_replacement !== false)}
                          className={`h-8 text-xs rounded-xl font-bold ${
                            w.allows_replacement !== false
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'text-rose-600 border-rose-500/30'
                          }`}
                        >
                          {w.allows_replacement !== false ? 'Habilitado para Reposição' : 'Desabilitado'}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Painel de Vínculo de Autorizações Operacionais */}
            <div className="space-y-3 pt-2 border-t border-border">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                Vincular Operador Autorizado
              </h3>

              <form onSubmit={handleAddAuthorization} className="grid grid-cols-1 md:grid-cols-4 gap-2 bg-muted/40 p-3 rounded-2xl border border-border">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold text-muted-foreground block mb-1">Operador</label>
                  <select
                    value={newOpId}
                    onChange={(e) => setNewOpId(e.target.value)}
                    className="w-full h-9 rounded-xl border border-border bg-background text-xs px-2 focus:outline-none"
                    required
                  >
                    <option value="">Selecione o operador...</option>
                    {operators.map(op => (
                      <option key={op.id} value={op.id}>
                        {op.name} ({op.registration})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-muted-foreground block mb-1">Turno</label>
                  <select
                    value={newShift}
                    onChange={(e) => setNewShift(e.target.value)}
                    className="w-full h-9 rounded-xl border border-border bg-background text-xs px-2 focus:outline-none"
                  >
                    <option value="1">Turno 1</option>
                    <option value="2">Turno 2</option>
                    <option value="3">Turno 3</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <Button type="submit" className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1">
                    <Plus className="w-4 h-4" />
                    Vincular
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

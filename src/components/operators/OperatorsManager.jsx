import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCells } from '@/hooks/useCells';
import OperatorForm from '@/components/operators/OperatorForm';
import OperatorList from '@/components/operators/OperatorList';

export default function OperatorsManager() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const { activeCells } = useCells();

  const { data: operators = [] } = useQuery({
    queryKey: ['operators'],
    queryFn: () => base44.entities.Operator.list('-created_date', 500),
    initialData: [],
  });

  const cellNames = activeCells.map((c) => c.name);

  const save = useMutation({
    mutationFn: (payload) =>
      editing
        ? base44.entities.Operator.update(editing.id, payload)
        : base44.entities.Operator.create(payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.success(editing ? 'Operador atualizado' : 'Operador cadastrado');
      
      // Se for um novo operador e login_enabled estiver ativo, pré-loga no sessionStorage
      if (!editing && variables.login_enabled) {
        const sessionPayload = {
          id: data.id,
          name: variables.name,
          registration: variables.registration,
          primary_cell: variables.primary_cell,
          cells: variables.cells || [],
          shift: variables.shift || '',
          login_enabled: true,
          expires_at: Date.now() + 8 * 60 * 60 * 1000 // 8 horas
        };
        sessionStorage.setItem('acprod_operator_session', JSON.stringify(sessionPayload));
        window.dispatchEvent(new Event('operator-session-changed'));
        toast.info(`Acesso imediato liberado para o operador ${variables.name}!`);
      }
      
      setEditing(null);
    },
    onError: () => toast.error('Falha ao salvar operador'),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.Operator.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.success('Operador removido');
    },
  });

  const handleSubmit = async (payload) => {
    setSaving(true);
    await save.mutateAsync(payload).catch(() => {});
    setSaving(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <OperatorForm
        operator={editing}
        cells={cellNames}
        onSubmit={handleSubmit}
        onCancel={() => setEditing(null)}
        saving={saving}
      />

      <OperatorList
        operators={operators}
        onEdit={setEditing}
        onDelete={(id) => remove.mutate(id)}
      />
    </div>
  );
}

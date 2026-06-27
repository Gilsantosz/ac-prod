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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.success(editing ? 'Operador atualizado' : 'Operador cadastrado');
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

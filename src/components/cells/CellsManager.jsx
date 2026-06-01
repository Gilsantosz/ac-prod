import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import CellForm from '@/components/cells/CellForm';
import CellList from '@/components/cells/CellList';

export default function CellsManager() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: cells = [] } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('-created_date', 200),
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

  const handleSubmit = async (payload) => {
    setSaving(true);
    if (editing) await update.mutateAsync({ id: editing.id, payload });
    else await create.mutateAsync(payload);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <CellForm onSubmit={handleSubmit} saving={saving} editing={editing} onCancel={() => setEditing(null)} />
      <CellList cells={cells} onEdit={setEditing} onDelete={(id) => remove.mutate(id)} />
    </div>
  );
}
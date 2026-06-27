import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { toast } from 'sonner';
import ManagerForm from './ManagerForm';
import ManagerList from './ManagerList';

export default function ManagersManager() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);

  const { data: managers = [] } = useQuery({
    queryKey: ['managers'],
    queryFn: () => base44.entities.Manager.filter({ role: 'manager' }, '-created_date', 500),
    initialData: [],
  });

  const save = useMutation({
    mutationFn: (payload) =>
      editing ? base44.entities.Manager.update(editing.id, payload) : base44.entities.Manager.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managers'] });
      toast.success(editing ? 'Gestor atualizado' : 'Gestor cadastrado');
      setEditing(null);
    },
    onError: (e) => toast.error(e?.message || 'Erro ao salvar gestor'),
  });

  const remove = useMutation({
    mutationFn: (m) => base44.entities.Manager.delete(m.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managers'] });
      toast.success('Gestor removido');
    },
  });

  return (
    <div className="space-y-6">
      <ManagerForm
        editing={editing}
        onSubmit={(p) => save.mutate(p)}
        onCancel={() => setEditing(null)}
        saving={save.isPending}
      />
      <ManagerList managers={managers} onEdit={setEditing} onDelete={(m) => remove.mutate(m)} />
    </div>
  );
}
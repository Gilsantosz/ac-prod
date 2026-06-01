import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import GoalForm from '@/components/goals/GoalForm';
import GoalList from '@/components/goals/GoalList';
import { useCells } from '@/hooks/useCells';

export default function GoalsManager() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: goals = [] } = useQuery({
    queryKey: ['dailyGoals'],
    queryFn: () => base44.entities.DailyGoal.list('-date', 200),
    initialData: [],
  });

  const { activeCells: cells } = useCells();

  const create = useMutation({
    mutationFn: (payload) => base44.entities.DailyGoal.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailyGoals'] });
      toast.success('Meta salva');
    },
    onError: () => toast.error('Falha ao salvar meta'),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.DailyGoal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailyGoals'] });
      toast.success('Meta removida');
    },
  });

  const handleSubmit = async (payload) => {
    setSaving(true);
    await create.mutateAsync(payload);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <GoalForm onSubmit={handleSubmit} saving={saving} cells={cells} />
      <GoalList goals={goals} onDelete={(id) => remove.mutate(id)} />
    </div>
  );
}
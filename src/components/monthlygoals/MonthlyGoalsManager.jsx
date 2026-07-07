import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCells } from '@/hooks/useCells';
import { calendarMap, workdaysInMonth, dailyTargetFromMonthly, dailyDistributionFromMonthly } from '@/lib/workdays';
import MonthlyGoalForm from './MonthlyGoalForm';
import MonthlyGoalList from './MonthlyGoalList';
import WorkdayCalendarEditor from './WorkdayCalendarEditor';

export default function MonthlyGoalsManager() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { activeCells } = useCells();

  const { data: goals = [] } = useQuery({
    queryKey: ['monthlyGoals'],
    queryFn: () => base44.entities.MonthlyGoal.list('-month', 300),
    initialData: [],
  });

  const { data: calendar = [] } = useQuery({
    queryKey: ['workdayCalendar'],
    queryFn: () => base44.entities.WorkdayCalendar.list('-date', 500),
    initialData: [],
  });

  const map = useMemo(() => calendarMap(calendar), [calendar]);
  const workdays = (month) => workdaysInMonth(month, map);
  const dailyPreview = (monthly, month) => dailyTargetFromMonthly(monthly, month, map);
  const dailyDistribution = (monthly, month) => dailyDistributionFromMonthly(monthly, month, map);

  const createGoal = useMutation({
    mutationFn: (payload) => base44.entities.MonthlyGoal.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyGoals'] });
      toast.success('Meta mensal salva');
    },
    onError: () => toast.error('Falha ao salvar meta'),
  });

  const removeGoal = useMutation({
    mutationFn: (id) => base44.entities.MonthlyGoal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyGoals'] });
      toast.success('Meta removida');
    },
  });

  const toggleDay = useMutation({
    mutationFn: async ({ date, isWorkday }) => {
      const existing = calendar.find((c) => c.date === date);
      if (existing) return base44.entities.WorkdayCalendar.update(existing.id, { isWorkday });
      return base44.entities.WorkdayCalendar.create({ date, isWorkday });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workdayCalendar'] }),
    onError: () => toast.error('Falha ao atualizar calendário'),
  });

  const updateGoal = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.MonthlyGoal.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyGoals'] });
      toast.success('Meta mensal atualizada');
    },
    onError: () => toast.error('Falha ao atualizar meta'),
  });

  const handleSubmit = async ({ existingId, ...payload }) => {
    setSaving(true);
    if (existingId) {
      await updateGoal.mutateAsync({ id: existingId, payload });
    } else {
      await createGoal.mutateAsync(payload);
    }
    setSaving(false);
  };


  return (
    <div className="space-y-6">
      <MonthlyGoalForm onSubmit={handleSubmit} saving={saving} cells={activeCells} workdays={workdays} dailyPreview={dailyPreview} dailyDistribution={dailyDistribution} goals={goals} />

      <WorkdayCalendarEditor entries={calendar} onToggle={(date, isWorkday) => toggleDay.mutate({ date, isWorkday })} />
      <MonthlyGoalList goals={goals} onDelete={(id) => removeGoal.mutate(id)} dailyPreview={dailyPreview} />
    </div>
  );
}

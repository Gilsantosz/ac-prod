import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Zap } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import RuleForm from '@/components/automations/RuleForm';
import RuleList from '@/components/automations/RuleList';
import NotificationSettings from '@/components/automations/NotificationSettings';

export default function Automations() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: rules = [] } = useQuery({
    queryKey: ['automationRules'],
    queryFn: () => base44.entities.AutomationRule.list('-created_date', 200),
    initialData: [],
  });

  const { data: production = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 500),
    initialData: [],
  });

  const cells = useMemo(() => [...new Set(production.map((e) => e.cell).filter(Boolean))], [production]);

  const create = useMutation({
    mutationFn: (payload) => base44.entities.AutomationRule.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success('Regra criada');
    },
    onError: () => toast.error('Falha ao criar regra'),
  });

  const toggle = useMutation({
    mutationFn: (rule) => base44.entities.AutomationRule.update(rule.id, { active: !rule.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automationRules'] }),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.AutomationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success('Regra removida');
    },
  });

  const handleSubmit = async (payload) => {
    setSaving(true);
    await create.mutateAsync(payload);
    setSaving(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Automações"
        subtitle="Defina condições e ações automáticas para padronizar seus processos de produção."
        icon={Zap}
      />

      <RuleForm onSubmit={handleSubmit} saving={saving} cells={cells} />
      <RuleList rules={rules} onToggle={(r) => toggle.mutate(r)} onDelete={(id) => remove.mutate(id)} />

      <div className="max-w-3xl pt-2">
        <NotificationSettings />
      </div>
    </div>
  );
}
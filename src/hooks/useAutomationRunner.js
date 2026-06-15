import { useCallback } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { evaluateEntry, describeRule } from '@/lib/automationRules';

// Avalia uma entrada de produção contra as regras ativas e executa as ações
export function useAutomationRunner() {
  const queryClient = useQueryClient();

  const { data: rules = [] } = useQuery({
    queryKey: ['automationRules'],
    queryFn: () => base44.entities.AutomationRule.list('-created_date', 200),
    initialData: [],
  });

  const run = useCallback(async (entry) => {
    const matches = evaluateEntry(rules, entry);
    if (!matches.length) return;

    for (const { rule, value } of matches) {
      if (rule.action === 'alert') {
        toast.warning(`⚙️ Regra "${rule.name}" disparada`, {
          description: `${describeRule(rule)} (valor: ${value})`,
          duration: 7000,
        });

        // Registrar o alerta no banco de dados para visualização e resolução em tempo real
        base44.entities.AlertLog.create({
          rule_id: rule.id,
          message: `Regra "${rule.name}" disparada: ${describeRule(rule)} (valor: ${value})`,
          cell: entry.cell,
          resolved: false,
        }).catch((err) => {
          console.error('[Automation Runner] Falha ao registrar AlertLog:', err);
        });
      } else if (rule.action === 'log_occurrence') {
        await base44.entities.Occurrence.create({
          date: entry.date,
          shift: entry.shift,
          cell: entry.cell,
          reason: rule.occurrenceReason || 'Outros',
          downtime: Number(entry.downtime) || 0,
          operator: entry.operator || '',
          notes: `Registro automático pela regra "${rule.name}" (${describeRule(rule)}, valor: ${value}).`,
        });
        toast.info(`📋 Ocorrência registrada automaticamente — ${rule.name}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['occurrences'] });
  }, [rules, queryClient]);

  return { run };
}
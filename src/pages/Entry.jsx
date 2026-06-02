import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import ProductionForm from '@/components/entry/ProductionForm';
import RecentEntries from '@/components/entry/RecentEntries';
import CriticalIssueDialog from '@/components/entry/CriticalIssueDialog';
import SyncStatus from '@/components/entry/SyncStatus';
import { isCritical } from '@/lib/productionMetrics';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useAutomationRunner } from '@/hooks/useAutomationRunner';

export default function Entry() {
  const queryClient = useQueryClient();
  const [criticalEntry, setCriticalEntry] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: entries = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 50),
    initialData: [],
  });

  const createEntry = (data) =>
    base44.entities.ProductionEntry.create(data).then(() => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
    });

  const { online, pending, syncing, save } = useOfflineSync(
    createEntry,
    (n) => toast.success(`${n} registro(s) sincronizado(s)`)
  );

  const { run: runAutomations } = useAutomationRunner();

  const handleSubmit = async (data) => {
    await save(data);
    if (online) {
      toast.success('Produção registrada');
      await runAutomations(data);
      if (isCritical(data)) {
        setCriticalEntry(data);
        setDialogOpen(true);
      }
    } else {
      toast.info('Sem conexão — registro salvo e será sincronizado ao reconectar');
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductionEntry.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production'] }),
  });

  const createIssue = async ({ owner, repo, entry }) => {
    try {
      const body = `**Falha crítica de produção**\n\n` +
        `- Data: ${entry.date}\n- Turno: ${entry.shift}\n- Célula: ${entry.cell}\n- Hora: ${entry.hour}\n` +
        `- Produzido: ${entry.produced} / Meta: ${entry.target || '—'}\n- Refugos: ${entry.scrap || 0}\n` +
        `- Parada: ${entry.downtime || 0} min\n- Operador: ${entry.operator || '—'}\n\n${entry.notes || ''}`;
      const res = await base44.functions.invoke('createCriticalIssue', {
        owner, repo,
        title: `🚨 Falha crítica — ${entry.cell} (${entry.date} ${entry.hour})`,
        body,
      });
      if (res.data?.success) toast.success('Issue criada no GitHub');
      return res.data;
    } catch (err) {
      return { error: err?.response?.data?.error || err.message };
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="bg-card/40 backdrop-blur-md border border-border/40 p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:shadow-md transition-all duration-300">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground/90 to-foreground/80 bg-clip-text">Entrada de Produção</h1>
          <p className="text-muted-foreground text-sm mt-1">Registre a produção por turno, célula e hora.</p>
        </div>
        <SyncStatus online={online} pending={pending} syncing={syncing} />
      </div>

      <ProductionForm onSubmit={handleSubmit} saving={false} />
      <RecentEntries entries={entries} onDelete={deleteMutation.mutate} />

      <CriticalIssueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={criticalEntry}
        onCreateIssue={createIssue}
      />
    </div>
  );
}
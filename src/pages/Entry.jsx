import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Barcode, PenLine, PlusCircle } from 'lucide-react';
import ProductionForm from '@/components/entry/ProductionForm';
import RecentEntries from '@/components/entry/RecentEntries';
import CriticalIssueDialog from '@/components/entry/CriticalIssueDialog';
import SyncStatus from '@/components/entry/SyncStatus';
import PageHeader from '@/components/ui/PageHeader';
import { isCritical } from '@/lib/productionMetrics';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useAutomationRunner } from '@/hooks/useAutomationRunner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TraceabilityCollection from '@/pages/TraceabilityCollection';

export default function Entry() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [criticalEntry, setCriticalEntry] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const activeMode = searchParams.get('modo') === 'coleta' ? 'collection' : 'manual';

  const handleModeChange = (mode) => {
    const nextParams = new URLSearchParams(searchParams);
    if (mode === 'collection') nextParams.set('modo', 'coleta');
    else nextParams.delete('modo');
    setSearchParams(nextParams, { replace: true });
  };

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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Entrada de Produção"
        subtitle="Registre a produção por turno, célula e hora."
        icon={PlusCircle}
        actions={<SyncStatus online={online} pending={pending} syncing={syncing} />}
      />

      <Tabs value={activeMode} onValueChange={handleModeChange} className="space-y-5">
        <TabsList className="h-auto p-1 bg-card border border-border rounded-md w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
          <TabsTrigger value="manual" className="h-10 gap-2"><PenLine className="w-4 h-4" /> Entrada Manual</TabsTrigger>
          <TabsTrigger value="collection" className="h-10 gap-2"><Barcode className="w-4 h-4" /> Coleta Código/RFID</TabsTrigger>
        </TabsList>
        <TabsContent value="manual" className="space-y-5">
          <ProductionForm onSubmit={handleSubmit} saving={false} />
          <RecentEntries entries={entries} onDelete={deleteMutation.mutate} />
        </TabsContent>
        <TabsContent value="collection">
          <TraceabilityCollection embedded />
        </TabsContent>
      </Tabs>

      <CriticalIssueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={criticalEntry}
        onCreateIssue={createIssue}
      />
    </div>
  );
}

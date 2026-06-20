import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlusCircle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCells } from '@/hooks/useCells';
import { isCritical } from '@/lib/productionMetrics';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useAutomationRunner } from '@/hooks/useAutomationRunner';

// Componentes Industriais MES
import ManualProductionTabs from '@/components/entry/ManualProductionTabs';
import ManualQuickEntryForm from '@/components/entry/ManualQuickEntryForm';
import ManualCompleteEntryForm from '@/components/entry/ManualCompleteEntryForm';
import HourSummaryCard from '@/components/entry/HourSummaryCard';
import ProductionContextCard from '@/components/entry/ProductionContextCard';
import EntryCorrectionDialog from '@/components/entry/EntryCorrectionDialog';
import EntryDuplicateDialog from '@/components/entry/EntryDuplicateDialog';
import OccurrenceQuickDialog from '@/components/entry/OccurrenceQuickDialog';
import RecentEntries from '@/components/entry/RecentEntries';
import CriticalIssueDialog from '@/components/entry/CriticalIssueDialog';
import SyncStatus from '@/components/entry/SyncStatus';
import PageHeader from '@/components/ui/PageHeader';
import TraceabilityCollection from '@/pages/TraceabilityCollection';

// Servicos
import { processManualProductionEntry } from '@/lib/productionEntryService';
import { format } from 'date-fns';
import { Tabs, TabsContent } from '@/components/ui/tabs';

function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1º Turno';
  if (h >= 14 && h < 22) return '2º Turno';
  return '3º Turno';
}

function getCurrentHour() {
  return `${String(new Date().getHours()).padStart(2, '0')}:00`;
}

function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function Entry() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getShiftHours } = useCells();

  // Estados dos diálogos
  const [criticalEntry, setCriticalEntry] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [pendingPayload, setPendingPayload] = useState(null);
  const [duplicateEntry, setDuplicateEntry] = useState(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);

  const [correctionEntry, setCorrectionEntry] = useState(null);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [correctionLoading, setCorrectionLoading] = useState(false);

  const [occurrenceSuggestion, setOccurrenceSuggestion] = useState(null);
  const [occurrenceDialogOpen, setOccurrenceDialogOpen] = useState(false);
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);

  // Modo ativo das Abas MES
  const modeParam = searchParams.get('modo');
  const activeMode = (modeParam === 'coleta' || modeParam === 'collection')
    ? 'collection'
    : (modeParam || 'quick');

  const handleModeChange = (mode) => {
    const nextParams = new URLSearchParams(searchParams);
    if (mode === 'collection') {
      nextParams.set('modo', 'coleta');
    } else {
      nextParams.set('modo', mode);
    }
    setSearchParams(nextParams, { replace: true });
  };

  // Contexto ativo (selecionado no form) para o Resumo
  const [activeContext, setActiveContext] = useState({
    cell: user?.cell || '',
    shift: getCurrentShift(),
    date: getTodayStr(),
    hour: getCurrentHour()
  });

  // Fechamento de hora em LocalStorage
  const [closedHours, setClosedHours] = useState(() => {
    try {
      const stored = localStorage.getItem('closed_hours_ac_prod');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const handleCloseHour = () => {
    const key = `${activeContext.date}_${activeContext.shift}_${activeContext.cell}_${activeContext.hour}`;
    if (!closedHours.includes(key)) {
      const updated = [...closedHours, key];
      setClosedHours(updated);
      localStorage.setItem('closed_hours_ac_prod', JSON.stringify(updated));
      toast.success(`Hora ${activeContext.hour} fechada com sucesso!`);
    }
  };

  const isHourClosed = closedHours.includes(
    `${activeContext.date}_${activeContext.shift}_${activeContext.cell}_${activeContext.hour}`
  );

  // Lista de lançamentos
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

  // Processa e salva lançamentos normais
  const handleSubmit = async (data) => {
    // 1. Processar e validar
    const result = processManualProductionEntry(data, {
      user,
      existingEntries: entries,
      online,
      currentDateTime: new Date()
    });

    if (!result.success) {
      if (result.status === 'duplicate') {
        setPendingPayload(data);
        setDuplicateEntry(result.duplicateEntry);
        setDuplicateDialogOpen(true);
      } else {
        toast.error(result.message || 'Erro de validação');
      }
      return;
    }

    // 2. Salvar
    await saveEntry(result.payload, result.suggestedOccurrences);
  };

  const saveEntry = async (normalizedPayload, suggestedOccurrences = []) => {
    try {
      await save(normalizedPayload);
      if (online) {
        toast.success('Produção registrada');
        await runAutomations(normalizedPayload);
        if (isCritical(normalizedPayload)) {
          setCriticalEntry(normalizedPayload);
          setDialogOpen(true);
        }
        if (suggestedOccurrences && suggestedOccurrences.length > 0) {
          setOccurrenceSuggestion(suggestedOccurrences[0]);
          setOccurrenceDialogOpen(true);
        }
      } else {
        toast.info('Sem conexão — registro salvo e será sincronizado ao reconectar');
      }
    } catch (err) {
      toast.error('Erro ao salvar apontamento: ' + err.message);
    }
  };

  // Resolvendo duplicidade detectada
  const handleResolveDuplicate = async (action) => {
    if (action === 'cancel') {
      setDuplicateDialogOpen(false);
      setPendingPayload(null);
      setDuplicateEntry(null);
      return;
    }

    try {
      if (action === 'sum') {
        const updated = {
          ...duplicateEntry,
          produced: (Number(duplicateEntry.produced) || 0) + (Number(pendingPayload.produced) || 0),
          scrap: (Number(duplicateEntry.scrap) || 0) + (Number(pendingPayload.scrap) || 0),
          downtime: (Number(duplicateEntry.downtime) || 0) + (Number(pendingPayload.downtime) || 0),
          notes: (duplicateEntry.notes ? duplicateEntry.notes + '\n' : '') + (pendingPayload.notes || '')
        };
        await base44.entities.ProductionEntry.update(duplicateEntry.id, updated);
        toast.success('Valores somados ao lançamento existente.');
      } else if (action === 'replace') {
        const updated = {
          ...duplicateEntry,
          produced: Number(pendingPayload.produced) || 0,
          scrap: Number(pendingPayload.scrap) || 0,
          downtime: Number(pendingPayload.downtime) || 0,
          notes: pendingPayload.notes || '',
          operator: pendingPayload.operator
        };
        await base44.entities.ProductionEntry.update(duplicateEntry.id, updated);
        toast.success('Lançamento anterior substituído.');
      } else if (action === 'new') {
        const newPayload = { ...pendingPayload, _skipDuplicateCheck: true };
        const result = processManualProductionEntry(newPayload, {
          user,
          existingEntries: entries,
          online,
          currentDateTime: new Date()
        });
        if (result.success) {
          await saveEntry(result.payload, result.suggestedOccurrences);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['production'] });
    } catch (err) {
      toast.error('Erro ao resolver duplicidade: ' + err.message);
    } finally {
      setDuplicateDialogOpen(false);
      setPendingPayload(null);
      setDuplicateEntry(null);
    }
  };

  // Correção / Auditoria
  const handleCorrectEntrySubmit = async (correctionData) => {
    try {
      setCorrectionLoading(true);
      const targetEntry = entries.find(e => e.id === correctionData.entryId);
      if (!targetEntry) throw new Error('Lançamento não localizado.');

      let status = 'valid';
      if (correctionData.actionType === 'reverse') status = 'reversed';
      else if (correctionData.actionType === 'cancel') status = 'cancelled';
      else if (correctionData.actionType === 'correct') status = 'corrected';
      else if (correctionData.actionType === 'request_review') status = 'pending_review';

      const updated = {
        ...targetEntry,
        approval_status: status,
        correction_reason: correctionData.reason,
        corrected_by: correctionData.correctedBy,
        corrected_at: correctionData.currentDateTime
      };

      await base44.entities.ProductionEntry.update(correctionData.entryId, updated);

      await base44.entities.SystemAuditLog.create({
        action: correctionData.actionType + '_entry',
        entity: 'production_entry',
        details: { entryId: correctionData.entryId, reason: correctionData.reason }
      });

      toast.success('Registro de auditoria atualizado!');
      queryClient.invalidateQueries({ queryKey: ['production'] });
    } catch (err) {
      toast.error('Erro na auditoria: ' + err.message);
    } finally {
      setCorrectionLoading(false);
      setCorrectionDialogOpen(false);
      setCorrectionEntry(null);
    }
  };

  // Ocorrência
  const handleCreateOccurrenceSubmit = async (occurrenceData) => {
    try {
      setOccurrenceLoading(true);
      await base44.entities.Occurrence.create({
        date: occurrenceData.date,
        shift: occurrenceData.shift,
        cell: occurrenceData.cell,
        operator: occurrenceData.operator,
        reason: occurrenceData.reason,
        downtime: occurrenceData.downtime || 0,
        notes: occurrenceData.notes,
        reason_category: occurrenceData.type || 'others',
        affects_traceability: occurrenceData.type === 'quality'
      });
      toast.success('Ocorrência registrada com sucesso.');
      setOccurrenceDialogOpen(false);
      setOccurrenceSuggestion(null);
    } catch (err) {
      toast.error('Erro ao registrar ocorrência: ' + err.message);
    } finally {
      setOccurrenceLoading(false);
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

  // Calcula valores agregados para a hora ativa no Resumo
  const matchingActiveEntries = entries.filter(e =>
    e.date === activeContext.date &&
    e.shift === activeContext.shift &&
    e.cell === activeContext.cell &&
    e.hour === activeContext.hour
  );

  const validMatchingActiveEntries = matchingActiveEntries.filter(e => e.approval_status === 'valid' || !e.approval_status);

  const totalProduced = validMatchingActiveEntries.reduce((sum, e) => sum + (Number(e.produced) || 0), 0);
  const totalScrap = validMatchingActiveEntries.reduce((sum, e) => sum + (Number(e.scrap) || 0), 0);
  const totalDowntime = validMatchingActiveEntries.reduce((sum, e) => sum + (Number(e.downtime) || 0), 0);

  const firstWithTarget = validMatchingActiveEntries.find(e => Number(e.target) > 0);
  const [suggestedTarget, setSuggestedTarget] = useState(0);

  useEffect(() => {
    async function fetchGoal() {
      if (!activeContext.cell || !activeContext.date) return;
      const goals = await base44.entities.DailyGoal.filter({
        date: activeContext.date,
        shift: activeContext.shift,
        cell: activeContext.cell,
      });
      const goal = goals[0];
      const h = getShiftHours(activeContext.cell, activeContext.shift) || 8;
      if (goal && Number(goal.target) > 0 && h > 0) {
        setSuggestedTarget(Math.round(Number(goal.target) / h));
      } else {
        setSuggestedTarget(0);
      }
    }
    fetchGoal();
  }, [activeContext, getShiftHours]);

  const activeTarget = firstWithTarget ? Number(firstWithTarget.target) : suggestedTarget;
  const activeEfficiency = activeTarget > 0 ? Math.round((totalProduced / activeTarget) * 100) : 100;

  // Handler de correção na lista/resumo
  const triggerCorrection = (entry) => {
    setCorrectionEntry(entry);
    setCorrectionDialogOpen(true);
  };

  // Handler de ocorrência na lista/resumo
  const triggerOccurrence = (entry) => {
    setOccurrenceSuggestion({
      type: Number(entry.scrap) > 0 ? 'quality' : (Number(entry.downtime) > 0 ? 'downtime' : 'low_efficiency'),
      cell: entry.cell,
      shift: entry.shift,
      date: entry.date,
      hour: entry.hour,
      operator: entry.operator,
      quantity: Number(entry.scrap) || 0,
      downtime: Number(entry.downtime) || 0,
      notes: entry.notes || '',
      reason: Number(entry.scrap) > 0 ? 'Qualidade / Refugo' : (Number(entry.downtime) > 0 ? 'Outros' : 'Baixa Produtividade')
    });
    setOccurrenceDialogOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Apontamento MES"
        subtitle="Painel de lançamento manual, coletores, ocorrências e auditoria."
        icon={PlusCircle}
        actions={<SyncStatus online={online} pending={pending} syncing={syncing} />}
      />

      {/* Card de Contexto Ativo */}
      <ProductionContextCard
        user={user || {}}
        cellName={activeContext.cell}
        shift={activeContext.shift}
        date={activeContext.date}
        online={online}
        pendingCount={pending}
        activeTab={activeMode}
      />

      <Tabs value={activeMode} onValueChange={handleModeChange} className="space-y-5">
        <ManualProductionTabs />

        {/* Tab: Manual Rápido */}
        <TabsContent value="quick" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ManualQuickEntryForm
                user={user || {}}
                onSubmit={handleSubmit}
                saving={false}
                onContextChange={setActiveContext}
              />
            </div>
            <div className="lg:col-span-1">
              <HourSummaryCard
                date={activeContext.date}
                shift={activeContext.shift}
                cell={activeContext.cell}
                hour={activeContext.hour}
                produced={totalProduced}
                target={activeTarget}
                efficiency={activeEfficiency}
                scrap={totalScrap}
                downtime={totalDowntime}
                entriesCount={validMatchingActiveEntries.length}
                isClosed={isHourClosed}
                onCloseHour={handleCloseHour}
                onCorrect={() => validMatchingActiveEntries[0] && triggerCorrection(validMatchingActiveEntries[0])}
                onAddOccurrence={() => validMatchingActiveEntries[0] && triggerOccurrence(validMatchingActiveEntries[0])}
              />
            </div>
          </div>
        </TabsContent>

        {/* Tab: Manual Completo */}
        <TabsContent value="complete" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ManualCompleteEntryForm
                user={user || {}}
                onSubmit={handleSubmit}
                saving={false}
                onContextChange={setActiveContext}
              />
            </div>
            <div className="lg:col-span-1">
              <HourSummaryCard
                date={activeContext.date}
                shift={activeContext.shift}
                cell={activeContext.cell}
                hour={activeContext.hour}
                produced={totalProduced}
                target={activeTarget}
                efficiency={activeEfficiency}
                scrap={totalScrap}
                downtime={totalDowntime}
                entriesCount={validMatchingActiveEntries.length}
                isClosed={isHourClosed}
                onCloseHour={handleCloseHour}
                onCorrect={() => validMatchingActiveEntries[0] && triggerCorrection(validMatchingActiveEntries[0])}
                onAddOccurrence={() => validMatchingActiveEntries[0] && triggerOccurrence(validMatchingActiveEntries[0])}
              />
            </div>
          </div>
        </TabsContent>

        {/* Tab: Coleta Código / RFID */}
        <TabsContent value="collection" className="space-y-5">
          <TraceabilityCollection embedded />
        </TabsContent>

        {/* Tab: Histórico Recente */}
        <TabsContent value="history" className="space-y-5">
          <RecentEntries
            entries={entries}
            onDelete={deleteMutation.mutate}
            onCorrect={triggerCorrection}
            onAddOccurrence={triggerOccurrence}
          />
        </TabsContent>
      </Tabs>

      {/* Diálogos MES */}
      <EntryDuplicateDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        duplicateEntry={duplicateEntry}
        userRole={user?.role || 'operator'}
        onResolve={handleResolveDuplicate}
      />

      <EntryCorrectionDialog
        open={correctionDialogOpen}
        onOpenChange={setCorrectionDialogOpen}
        entry={correctionEntry}
        user={user || {}}
        onSubmit={handleCorrectEntrySubmit}
        loading={correctionLoading}
      />

      <OccurrenceQuickDialog
        open={occurrenceDialogOpen}
        onOpenChange={setOccurrenceDialogOpen}
        suggestion={occurrenceSuggestion}
        onSubmit={handleCreateOccurrenceSubmit}
        loading={occurrenceLoading}
      />

      <CriticalIssueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={criticalEntry}
        onCreateIssue={createIssue}
      />
    </div>
  );
}

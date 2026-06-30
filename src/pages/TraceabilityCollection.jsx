import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, RadioTower, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import TraceabilityKpiCards from '@/components/traceability/TraceabilityKpiCards';
import CollectionContextSummary from '@/components/traceability/CollectionContextSummary';
import PieceRouteTimeline from '@/components/traceability/PieceRouteTimeline';
import LastReadingsList from '@/components/traceability/LastReadingsList';
import RejectionOccurrenceDialog from '@/components/traceability/RejectionOccurrenceDialog';
import RfidReadinessPanel from '@/components/traceability/RfidReadinessPanel';
import OccurrenceQuickDialog from '@/components/entry/OccurrenceQuickDialog';
import CollectionQueuePanel from '@/components/entry/CollectionQueuePanel';
import { useAuth } from '@/lib/AuthContext';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useCollectionQueue } from '@/hooks/useCollectionQueue';
import { useCells } from '@/hooks/useCells';
import { base44 } from '@/lib/localDb';
import {
  fetchCollectionKpis,
  fetchRecentReadings,
  processProductionReading,
  registerTraceabilityRejection,
  fetchProductionMachines,
} from '@/lib/traceabilityService';
import { registerReadingOccurrence } from '@/lib/productionHistoryService';

function currentShift() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return '1º Turno';
  if (hour >= 14 && hour < 22) return '2º Turno';
  return '3º Turno';
}

function isClosedLotContext(feedback) {
  const closedStatuses = new Set(['completed', 'shipped', 'cancelled', 'closed']);
  return closedStatuses.has(feedback?.lot?.current_status) || closedStatuses.has(feedback?.lot?.status);
}

export default function TraceabilityCollection({ embedded = false }) {
  const { user } = useAuth();
  const { session: opSession } = useOperatorSession();
  const { activeCells, isLoading: cellsLoading } = useCells();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('scanner');
  const [feedback, setFeedback] = useState(() => {
    try {
      const saved = localStorage.getItem('traceability-last-feedback');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isClosedLotContext(parsed)) {
          return null;
        }
        return parsed;
      }
    } catch (_) {}
    return null;
  });

  const updateFeedback = useCallback((newFeedback) => {
    if (isClosedLotContext(newFeedback)) {
      setFeedback(null);
      try { localStorage.removeItem('traceability-last-feedback'); } catch (_) {}
      return;
    }
    setFeedback(newFeedback);
    if (newFeedback) {
      try {
        // Salvar apenas os campos essenciais para evitar circular references
        const toSave = {
          success: newFeedback.success,
          status: newFeedback.status,
          message: newFeedback.message,
          lot: newFeedback.lot ? {
            id: newFeedback.lot.id,
            lot_code: newFeedback.lot.lot_code,
            current_status: newFeedback.lot.current_status,
            status: newFeedback.lot.status,
          } : null,
          item: newFeedback.item ? {
            id: newFeedback.item.id,
            item_code: newFeedback.item.item_code,
            current_step: newFeedback.item.current_step,
            status: newFeedback.item.status,
          } : null,
          route: newFeedback.route ? {
            id: newFeedback.route.id,
            step_name: newFeedback.route.step_name,
            cell_name: newFeedback.route.cell_name,
            step_order: newFeedback.route.step_order,
          } : null,
          reading: newFeedback.reading ? {
            id: newFeedback.reading.id,
            tag_id: newFeedback.reading.tag_id,
            tag_value: newFeedback.reading.tag_value,
            reader_type: newFeedback.reading.reader_type,
            station_name: newFeedback.reading.station_name,
            cell_name: newFeedback.reading.cell_name,
            operator: newFeedback.reading.operator,
            status: newFeedback.reading.status,
            is_rework: newFeedback.reading.is_rework,
          } : null,
        };
        localStorage.setItem('traceability-last-feedback', JSON.stringify(toSave));
      } catch (_) {}
    } else {
      try { localStorage.removeItem('traceability-last-feedback'); } catch (_) {}
    }
  }, []);

  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Ocorrência por leitura específica
  const [readingOccurrenceOpen, setReadingOccurrenceOpen] = useState(false);
  const [readingOccurrenceSuggestion, setReadingOccurrenceSuggestion] = useState(null);
  const [readingOccurrenceLoading, setReadingOccurrenceLoading] = useState(false);

  // Operador e célula: preferir sessão operacional, fallback para auth
  const operator = opSession?.name || user?.name || user?.email || '';
  const operatorId = opSession?.id || null;

  const [cellName, setCellName] = useState(() => {
    // Célula da sessão operacional tem prioridade
    if (opSession?.primary_cell) return opSession.primary_cell;
    try { return user?.cell || localStorage.getItem('traceability-cell') || ''; }
    catch { return user?.cell || ''; }
  });

  const [shift, setShift] = useState(() => opSession?.shift || currentShift());

  // Máquina selecionada
  const [machine, setMachine] = useState(null);

  // Sincronizar célula e turno quando a sessão operacional mudar
  useEffect(() => {
    if (opSession?.primary_cell) setCellName(opSession.primary_cell);
    if (opSession?.shift) setShift(opSession.shift);
  }, [opSession?.primary_cell, opSession?.shift]);

  useEffect(() => {
    if (!cellName) return;
    try { localStorage.setItem('traceability-cell', cellName); }
    catch { /* armazenamento indisponível */ }
  }, [cellName]);

  // Carregar máquinas da célula
  const { data: machines = [], isLoading: machinesLoading } = useQuery({
    queryKey: ['production-machines', cellName],
    queryFn: () => fetchProductionMachines(cellName),
    enabled: !!cellName,
    initialData: [],
  });

  // Auto-selecionar ou recuperar máquina
  useEffect(() => {
    if (machines.length === 1) {
      setMachine(machines[0]);
    } else if (machines.length > 1) {
      const savedId = sessionStorage.getItem(`selected-machine-id-${cellName}`);
      const savedMachine = machines.find(m => m.id === savedId);
      if (savedMachine) {
        setMachine(savedMachine);
      } else {
        setMachine(null);
      }
    } else {
      setMachine(null);
    }
  }, [machines, cellName]);

  const handleMachineChange = (selected) => {
    setMachine(selected);
    if (selected) {
      sessionStorage.setItem(`selected-machine-id-${cellName}`, selected.id);
    } else {
      sessionStorage.removeItem(`selected-machine-id-${cellName}`);
    }
  };

  // Queries baseadas em hooks reativos — sempre busca dado fresco ao montar
  const { data: readings = [], isFetching: readingsLoading } = useQuery({
    queryKey: ['stageReadings', cellName, machine?.id, feedback?.lot?.id],
    queryFn: () => fetchRecentReadings({
      cellName,
      machineId: feedback?.lot?.id ? null : machine?.id,
      lotId: feedback?.lot?.id || null,
      limit: feedback?.lot?.id ? null : 250,
    }),
    initialData: [],
    staleTime: 0,
    refetchOnMount: true,
    retry: false,
  });

  const { data: kpis = {} } = useQuery({
    queryKey: ['realtimeCounters', cellName, machine?.id],
    queryFn: () => fetchCollectionKpis({ cellName, machineId: machine?.id }),
    initialData: { total: 0, approved: 0, rejected: 0, blocked: 0 },
    staleTime: 0,
    refetchOnMount: true,
    retry: false,
  });

  const lotId = feedback?.lot?.id;
  const { data: route = [] } = useQuery({
    queryKey: ['production-route', lotId],
    queryFn: () => base44.entities.ProductionRoute.filter({ lot_id: lotId }, 'step_order'),
    enabled: !!lotId,
    initialData: [],
    retry: false,
  });

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stageReadings', cellName, machine?.id] });
    queryClient.invalidateQueries({ queryKey: ['realtimeCounters', cellName, machine?.id] });
    queryClient.invalidateQueries({ queryKey: ['production'] });
    queryClient.invalidateQueries({ queryKey: ['production-lots'] });
    queryClient.invalidateQueries({ queryKey: ['occurrences'] });
  }, [queryClient, cellName, machine]);

  // ─── Função que processa um evento da fila ──────────────────────────────────

  const processEvent = useCallback(async (event) => {
    if (!event.cellName && !cellName) throw new Error('Célula não definida.');
    const result = await processProductionReading({
      rawValue: event.raw_value || event.rawValue,
      cellName: event.cellName || cellName,
      shift: event.shift || shift,
      operator: event.operator || operator,
      operatorId: event.operatorId || operatorId,
      client_event_id: event.client_event_id,
      readerType: event.readerType || 'keyboard_barcode',
      machineId: event.machineId || machine?.id || null,
      machineName: event.machineName || machine?.name || null,
      enqueue_duration_ms: event.enqueue_duration_ms || 0,
      ...event,
    });
    refreshData();
    return result;
  }, [cellName, shift, operator, operatorId, machine, refreshData]);

  // ─── Fila de coleta com filtros ─────────────────────────────────────────────
  const { stats: queueStats, flushing, enqueue, processNow, retryQueueErrors } = useCollectionQueue(processEvent, {
    cellName,
    machineId: machine?.id,
  });

  // ─── Handler principal de leitura — enfileira e processa ────────────────────
  const handleRead = useCallback(async (payload) => {
    if (!cellName) {
      const result = { success: false, status: 'invalid_context', message: 'Selecione a célula antes de processar a leitura.' };
      updateFeedback(result);
      toast.warning(result.message);
      return result;
    }
    if (!operator) {
      const result = { success: false, status: 'invalid_context', message: 'Não foi possível identificar o operador.' };
      updateFeedback(result);
      toast.error(result.message);
      return result;
    }

    const eventPayload = {
      ...payload,
      raw_value: payload.rawValue ?? payload.raw_value ?? '',
      cellName,
      shift,
      operator,
      operatorId,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
    };

    // Enfileirar (IndexedDB)
    const clientEventId = await enqueue(eventPayload, { autoFlush: false });

    // Feedback imediato otimista
    if (navigator.onLine) {
      try {
        const result = await processNow(clientEventId);
        updateFeedback({ ...result, client_event_id: clientEventId });
        if (result?.success) {
          toast.success(result.message || 'Leitura aprovada');
          navigator.vibrate?.([70, 40, 70]);
        } else if (['wrong_step', 'wrong_cell', 'duplicated'].includes(result?.status)) {
          toast.warning(result.message || 'Leitura bloqueada');
        } else {
          toast.error(result?.message || 'Leitura não aprovada');
        }
        return result;
      } catch (error) {
        const result = {
          success: false,
          status: 'error',
          client_event_id: clientEventId,
          message: error?.message || 'Leitura enfileirada para reenvio.',
        };
        updateFeedback(result);
        toast.error('Falha ao processar leitura. Enfileirada para reenvio automático.');
        return result;
      }
    } else {
      toast.info('Sem conexão. Leitura salva na fila local.');
      const result = { success: false, status: 'queued', client_event_id: clientEventId, message: 'Leitura salva na fila local.' };
      updateFeedback(result);
      return result;
    }
  }, [cellName, shift, operator, operatorId, machine, enqueue, processNow, updateFeedback]);

  const handleReject = async (form) => {
    if (!feedback?.item?.id) return;
    setRejecting(true);
    try {
      const result = await registerTraceabilityRejection({
        ...form,
        itemId: feedback.item.id,
        lotId: feedback.lot?.id,
        tagId: feedback.reading?.tag_id,
        tagValue: feedback.reading?.tag_value,
        readingId: feedback.reading?.id,
        readerType: feedback.reading?.reader_type || 'manual',
        stationName: feedback.reading?.station_name,
        stepName: feedback.route?.step_name || feedback.item.current_step,
        cellName: feedback.reading?.cell_name || cellName,
        operator: operator,
        operatorId,
        shift,
        machineId: machine?.id || null,
        machineName: machine?.name || null,
      });
      updateFeedback(result);
      setRejectionOpen(false);
      toast.success(result.message || 'Ocorrência registrada');
      refreshData();
    } catch (error) {
      toast.error(error?.message || 'Falha ao reprovar peça');
    } finally {
      setRejecting(false);
    }
  };

  // ─── Ocorrência vinculada a uma leitura específica ──────────────────────────
  const handleOpenReadingOccurrence = useCallback((reading) => {
    const now = new Date();
    setReadingOccurrenceSuggestion({
      type: reading.status === 'rejected' ? 'quality' : 'low_efficiency',
      cell: reading.cell_name || cellName,
      cell_name: reading.cell_name || cellName,
      shift: reading.shift || shift,
      date: reading.date || now.toISOString().slice(0, 10),
      operator: reading.operator || operator,
      stage_reading_id: reading.id,
      tag_value: reading.tag_value,
      lot_id: reading.lot_id || null,
      lot_code: null,
      severity: reading.status === 'rejected' ? 'high' : 'medium',
      reason: reading.status === 'rejected' ? 'Qualidade / Refugo' : 'Outros',
      notes: '',
      quantity: 0,
      downtime: 0,
      machine_id: machine?.id || null,
      machine_name: machine?.name || null,
    });
    setReadingOccurrenceOpen(true);
  }, [cellName, shift, operator, machine]);

  const handleReadingOccurrenceSubmit = async (form) => {
    setReadingOccurrenceLoading(true);
    try {
      await registerReadingOccurrence({
        ...form,
        cell_name: form.cell || form.cell_name,
      });
      toast.success('Ocorrência registrada com sucesso.');
      setReadingOccurrenceOpen(false);
      refreshData();
    } catch (error) {
      toast.error(error?.message || 'Falha ao registrar ocorrência.');
    } finally {
      setReadingOccurrenceLoading(false);
    }
  };

  const pageClass = embedded ? 'space-y-5' : 'p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto space-y-5 sm:space-y-6';

  const scanner = useMemo(() => (
    <TraceabilityScannerPanel
      mode={mode}
      onModeChange={setMode}
      onRead={handleRead}
      loading={false}
      feedback={feedback}
      cellName={cellName}
      shift={shift}
      operator={operator}
      machine={machine}
    />
  ), [mode, handleRead, feedback, cellName, shift, operator, machine]);

  const isCellLocked = !!(opSession?.primary_cell);

  return (
    <div className={pageClass}>
      {!embedded && (
        <PageHeader title="Coleta por Código / RFID" subtitle="Baixa produtiva por lote, peça, etapa e célula." icon={ScanLine} />
      )}

      {/* Contexto de coleta (célula, máquina, turno, operador) */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start bg-card border border-border rounded-md p-4">
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-cell" className="text-xs font-semibold text-muted-foreground">Célula da coleta</label>
          <select
            id="traceability-cell"
            value={cellName}
            onChange={(e) => setCellName(e.target.value)}
            disabled={cellsLoading || isCellLocked}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60 font-medium"
            required
          >
            <option value="">{cellsLoading ? 'Carregando células...' : activeCells.length ? 'Selecione a célula' : 'Nenhuma célula ativa'}</option>
            {activeCells.map((cell) => <option key={cell.id} value={cell.name}>{cell.name}</option>)}
          </select>
          {isCellLocked && <p className="text-[11px] text-muted-foreground">Célula definida pelo login operacional.</p>}
        </div>

        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-machine" className="text-xs font-semibold text-muted-foreground">Máquina / Posto</label>
          <select
            id="traceability-machine"
            value={machine?.id || ''}
            onChange={(e) => {
              const selected = machines.find(m => m.id === e.target.value);
              handleMachineChange(selected || null);
            }}
            disabled={machinesLoading || !cellName}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60 font-medium"
          >
            <option value="">{machinesLoading ? 'Carregando máquinas...' : machines.length ? 'Todas as máquinas' : 'Nenhuma máquina cadastrada'}</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-shift" className="text-xs font-semibold text-muted-foreground">Turno</label>
          <select
            id="traceability-shift"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-medium"
          >
            {['1º Turno', '2º Turno', '3º Turno'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 flex-1">
          <label className="text-xs font-semibold text-muted-foreground">Operador</label>
          <div className="h-10 rounded-md border border-input bg-secondary/50 px-3 flex items-center text-sm font-medium truncate">
            {operator || 'Não identificado'}
          </div>
        </div>
      </div>

      {/* Painel de status da fila */}
      <CollectionQueuePanel
        stats={queueStats}
        flushing={flushing}
        onRetry={retryQueueErrors}
        online={navigator.onLine}
      />

      <TraceabilityKpiCards kpis={kpis} />
      {scanner}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <CollectionContextSummary
          feedback={feedback}
          refreshToken={`${feedback?.reading?.id || feedback?.client_event_id || ''}-${queueStats.synced}-${readings[0]?.id || ''}`}
        />
        <PieceRouteTimeline route={route} currentStep={feedback?.item?.current_step} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <RfidReadinessPanel />
        <Button
          variant="destructive"
          className="gap-2 shrink-0"
          disabled={!feedback?.item?.id}
          onClick={() => setRejectionOpen(true)}
        >
          <AlertOctagon /> Registrar Ocorrência / Reprovar Peça
        </Button>
      </div>

      <LastReadingsList
        readings={readings}
        loading={readingsLoading}
        onOccurrence={handleOpenReadingOccurrence}
      />

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <RadioTower className="w-4 h-4" />
        Câmeras exigem HTTPS em produção. Scanner físico e modo manual continuam disponíveis sem câmera.
      </div>

      {/* Diálogos */}
      <RejectionOccurrenceDialog
        open={rejectionOpen}
        onOpenChange={setRejectionOpen}
        context={feedback}
        onSubmit={handleReject}
        loading={rejecting}
      />

      <OccurrenceQuickDialog
        open={readingOccurrenceOpen}
        onOpenChange={setReadingOccurrenceOpen}
        suggestion={readingOccurrenceSuggestion}
        onSubmit={handleReadingOccurrenceSubmit}
        loading={readingOccurrenceLoading}
      />
    </div>
  );
}

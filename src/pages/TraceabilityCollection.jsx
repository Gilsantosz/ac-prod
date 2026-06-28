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
} from '@/lib/traceabilityService';
import { registerReadingOccurrence } from '@/lib/productionHistoryService';

function currentShift() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return '1º Turno';
  if (hour >= 14 && hour < 22) return '2º Turno';
  return '3º Turno';
}

export default function TraceabilityCollection({ embedded = false }) {
  const { user } = useAuth();
  const { session: opSession } = useOperatorSession();
  const { activeCells, isLoading: cellsLoading } = useCells();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('scanner');
  const [feedback, setFeedback] = useState(null);
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

  const { data: readings = [], isFetching: readingsLoading } = useQuery({
    queryKey: ['production-stage-readings'],
    queryFn: () => fetchRecentReadings(1000),
    initialData: [],
    retry: false,
    refetchInterval: 15000,
  });

  const { data: kpis = {} } = useQuery({
    queryKey: ['traceability-collection-kpis'],
    queryFn: () => fetchCollectionKpis(),
    initialData: { total: 0, approved: 0, rejected: 0, blocked: 0 },
    retry: false,
    refetchInterval: 15000,
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
    queryClient.invalidateQueries({ queryKey: ['production-stage-readings'] });
    queryClient.invalidateQueries({ queryKey: ['traceability-collection-kpis'] });
    queryClient.invalidateQueries({ queryKey: ['production'] });
    queryClient.invalidateQueries({ queryKey: ['production-lots'] });
    queryClient.invalidateQueries({ queryKey: ['occurrences'] });
  }, [queryClient]);

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
      ...event,
    });
    refreshData();
    return result;
  }, [cellName, shift, operator, operatorId, refreshData]);

  // ─── Fila de coleta ─────────────────────────────────────────────────────────
  const { stats: queueStats, flushing, enqueue, processNow, retryQueueErrors } = useCollectionQueue(processEvent);

  // ─── Handler principal de leitura — enfileira e processa ────────────────────
  const handleRead = useCallback(async (payload) => {
    if (!cellName) {
      const result = { success: false, status: 'invalid_context', message: 'Selecione a célula antes de processar a leitura.' };
      setFeedback(result);
      toast.warning(result.message);
      return result;
    }
    if (!operator) {
      const result = { success: false, status: 'invalid_context', message: 'Não foi possível identificar o operador.' };
      setFeedback(result);
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
    };

    // Enfileirar (IndexedDB) — nunca descarta
    const clientEventId = await enqueue(eventPayload, { autoFlush: false });

    // Feedback imediato otimista
    if (navigator.onLine) {
      // Processa o mesmo evento persistido na fila local.
      try {
        const result = await processNow(clientEventId);
        setFeedback({ ...result, client_event_id: clientEventId });
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
        setFeedback(result);
        toast.error('Falha ao processar leitura. Enfileirada para reenvio automático.');
        return result;
      }
    } else {
      toast.info('Sem conexão. Leitura salva na fila local.');
      const result = { success: false, status: 'queued', client_event_id: clientEventId, message: 'Leitura salva na fila local.' };
      setFeedback(result);
      return result;
    }
  }, [cellName, shift, operator, operatorId, enqueue, processNow]);

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
        readerType: feedback.reading?.reader_type || 'manual',
        stationName: feedback.reading?.station_name,
        stepName: feedback.route?.step_name || feedback.item.current_step,
        cellName: feedback.reading?.cell_name || cellName,
        operator: operator,
        operatorId,
        shift,
      });
      setFeedback(result);
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
    });
    setReadingOccurrenceOpen(true);
  }, [cellName, shift, operator]);

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
    />
  ), [mode, handleRead, feedback, cellName, shift, operator]);

  const isCellLocked = !!(opSession?.primary_cell);

  return (
    <div className={pageClass}>
      {!embedded && (
        <PageHeader title="Coleta por Código / RFID" subtitle="Baixa produtiva por lote, peça, etapa e célula." icon={ScanLine} />
      )}

      {/* Contexto de coleta (célula, turno, operador) */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end bg-card border border-border rounded-md p-4">
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-cell" className="text-xs font-semibold text-muted-foreground">Célula da coleta</label>
          <select
            id="traceability-cell"
            value={cellName}
            onChange={(e) => setCellName(e.target.value)}
            disabled={cellsLoading || isCellLocked}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
            required
          >
            <option value="">{cellsLoading ? 'Carregando células...' : activeCells.length ? 'Selecione a célula' : 'Nenhuma célula ativa'}</option>
            {activeCells.map((cell) => <option key={cell.id} value={cell.name}>{cell.name}</option>)}
          </select>
          {isCellLocked && <p className="text-[11px] text-muted-foreground">Célula definida pelo login operacional.</p>}
        </div>
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-shift" className="text-xs font-semibold text-muted-foreground">Turno</label>
          <select
            id="traceability-shift"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {['1º Turno', '2º Turno', '3º Turno'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Operador</p>
          <div className="h-10 rounded-md border border-border bg-secondary/50 px-3 flex items-center text-sm font-medium truncate">
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

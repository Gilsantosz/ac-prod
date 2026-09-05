import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RadioTower, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import RfidReadinessPanel from '@/components/traceability/RfidReadinessPanel';
import OccurrenceQuickDialog from '@/components/entry/OccurrenceQuickDialog';
import CollectionQueuePanel from '@/components/entry/CollectionQueuePanel';
import { useAuth } from '@/lib/AuthContext';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useCollectionQueue } from '@/hooks/useCollectionQueue';
import { useCells } from '@/hooks/useCells';
import { getOperatorAllowedCells } from '@/lib/operatorCellRules';
import { fetchProductionMachines } from '@/lib/traceabilityService';
import { registerReadingOccurrence } from '@/lib/productionHistoryService';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEvent,
} from '@/lib/collectionEventDispatcher';

// Novos componentes operacionais da célula
import CollectionRecentReadsPanel from '@/components/collection/CollectionRecentReadsPanel';
import CollectionPieceDetailPanel from '@/components/collection/CollectionPieceDetailPanel';
import CollectionRejectPieceModal from '@/components/collection/CollectionRejectPieceModal';
import CollectionPieceTraceabilityDrawer from '@/components/collection/CollectionPieceTraceabilityDrawer';
import TraceabilityKpiCards from '@/components/traceability/TraceabilityKpiCards';
import ActiveDowntimeBanner from '@/components/collection/ActiveDowntimeBanner';
import DowntimeDialog from '@/components/collection/DowntimeDialog';
import CollectionFullscreenKiosk from '@/components/collection/CollectionFullscreenKiosk';
import CollectionVolumeEntryPanel from '@/components/collection/CollectionVolumeEntryPanel';
import CollectionErrorBoundary from '@/components/ui/CollectionErrorBoundary';
import { getActiveDowntime } from '@/lib/downtimeService';
import { recordSessionActivity } from '@/lib/sessionActivity';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';
import {
  getPieceTraceability,
  rejectPieceFromCollection,
  getCollectionKpis,
  getOperatorShiftKpisV2,
  requestPieceReplacement,
} from '@/lib/collectionService';

function currentShift() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return '1º Turno';
  if (hour >= 14 && hour < 22) return '2º Turno';
  return '3º Turno';
}

function getShiftRange(shift, reference = new Date(), startTime = null, endTime = null) {
  const start = new Date(reference);
  const end = new Date(reference);

  if (startTime && endTime) {
    const [sH, sM] = String(startTime).split(':').map(Number);
    const [eH, eM] = String(endTime).split(':').map(Number);
    
    start.setHours(sH || 0, sM || 0, 0, 0);
    end.setHours(eH || 0, eM || 0, 0, 0);

    // Turnos que viram a noite (ex: 22:00 até 06:00)
    if (end <= start) {
      if (reference.getHours() < (eH || 0)) {
        start.setDate(start.getDate() - 1);
      } else {
        end.setDate(end.getDate() + 1);
      }
    }
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
  }

  if (shift === '1º Turno') {
    start.setHours(6, 0, 0, 0);
    end.setHours(14, 0, 0, 0);
  } else if (shift === '2º Turno') {
    start.setHours(14, 0, 0, 0);
    end.setHours(22, 0, 0, 0);
  } else {
    if (reference.getHours() < 6) start.setDate(start.getDate() - 1);
    start.setHours(22, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 1);
    end.setHours(6, 0, 0, 0);
  }

  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}


function mergeCanonicalPiece(previous, traceability) {
  const canonical = traceability?.piece || {};
  const lot = canonical.production_lots || {};
  const order = lot.production_orders || {};
  const readings = traceability?.readings || [];

  return {
    ...(previous || {}),
    ...canonical,
    id: canonical.id || previous?.id,
    piece_uid: canonical.piece_uid || canonical.traceability_code || previous?.piece_uid,
    traceability_code: canonical.traceability_code || canonical.piece_uid || previous?.traceability_code,
    piece_name: canonical.piece_name || previous?.piece_name,
    status: canonical.status || previous?.status,
    replacement_status: canonical.replacement_status || previous?.replacement_status,
    lot_id: canonical.lot_id || lot.id || previous?.lot_id,
    lot_code: canonical.lot_code || lot.lot_code || previous?.lot_code,
    order_number: canonical.order_number || order.order_number || order.order_code || previous?.order_number,
    client_name: canonical.customer_name || order.customer_name || lot.customer_name || previous?.client_name,
    current_stage: canonical.current_stage || previous?.current_stage,
    current_stage_name: canonical.current_stage || previous?.current_stage_name,
    route: traceability?.route || previous?.route || [],
    completedSteps: readings.filter((reading) => reading.status === 'approved').map((reading) => reading.step_name),
  };
}

function isClosedLotContext(feedback) {
  const closedStatuses = new Set(['completed', 'shipped', 'cancelled', 'closed', 'waiting_packaging']);
  return closedStatuses.has(feedback?.lot?.current_status) ||
         closedStatuses.has(feedback?.lot?.status) ||
         (Number(feedback?.lot_progress_percent) >= 100);
}

export default function TraceabilityCollection({ embedded = false }) {
  const { user } = useAuth();
  const { session: opSession, setContext: setOpSessionContext } = useOperatorSession();
  const { activeCells, isLoading: cellsLoading } = useCells();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('scanner');
  
  const [searchParams] = useSearchParams();
  const urlPieceCode = searchParams.get('code') || searchParams.get('piece') || searchParams.get('q') || searchParams.get('openTraceability');

  useEffect(() => {
    if (urlPieceCode) {
      setTraceabilityCodeForDrawer(urlPieceCode);
      setTraceabilityOpen(true);
    }
  }, [urlPieceCode]);

  // Estados para as duas colunas operacionais da célula
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [selectedPieceEvents, setSelectedPieceEvents] = useState([]);
  const [loadingPieceEvents, setLoadingPieceEvents] = useState(false);
  const [traceabilityCodeForDrawer, setTraceabilityCodeForDrawer] = useState(null);
  const [traceabilityOpen, setTraceabilityOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [pieceToReject, setPieceToReject] = useState(null);
  const [refreshReadsSignal, setRefreshReadsSignal] = useState(0);

  // Estado para registro de paradas operacionais e modo kiosk em tela cheia
  const [downtimeDialogOpen, setDowntimeDialogOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);

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
    } catch {}
    return null;
  });
  const latestClientEventIdRef = useRef(feedback?.client_event_id || null);

  const updateFeedback = useCallback((newFeedback) => {
    if (isClosedLotContext(newFeedback)) {
      setFeedback(null);
      try { localStorage.removeItem('traceability-last-feedback'); } catch {}
      return;
    }
    setFeedback(newFeedback);
    if (newFeedback) {
      try {
        const toSave = {
          client_event_id: newFeedback.client_event_id,
          collection_state: newFeedback.collection_state,
          success: newFeedback.success,
          status: newFeedback.status,
          message: newFeedback.message,
          lot: newFeedback.lot ? {
            id: newFeedback.lot.id,
            lot_code: newFeedback.lot.lot_code,
            current_status: newFeedback.lot.current_status,
            status: newFeedback.lot.status,
            progress_percent: newFeedback.lot.progress_percent,
            pcp_import_batch_id: newFeedback.lot.pcp_import_batch_id,
          } : null,
          order: newFeedback.order ? {
            id: newFeedback.order.id,
            order_code: newFeedback.order.order_code,
            order_number: newFeedback.order.order_number,
            customer_name: newFeedback.order.customer_name,
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
          lot_progress_percent: newFeedback.lot_progress_percent,
        };
        localStorage.setItem('traceability-last-feedback', JSON.stringify(toSave));
      } catch {}
    } else {
      try { localStorage.removeItem('traceability-last-feedback'); } catch {}
    }
  }, []);

  const [rejecting, setRejecting] = useState(false);

  // Ocorrência por leitura específica
  const [readingOccurrenceOpen, setReadingOccurrenceOpen] = useState(false);
  const [readingOccurrenceSuggestion, setReadingOccurrenceSuggestion] = useState(null);
  const [readingOccurrenceLoading, setReadingOccurrenceLoading] = useState(false);

  // Operador e célula: preferir sessão operacional, fallback para auth
  const operator = opSession?.name || user?.name || user?.email || '';
  const operatorId = opSession?.id || null;

  // Listas de células estritamente autorizadas para este operador
  const displayCells = useMemo(() => {
    return getOperatorAllowedCells({ user, opSession, allCells: activeCells });
  }, [user, opSession, activeCells]);

  const [cellName, setCellName] = useState(() => {
    if (opSession?.primary_cell) {
      const pCell = opSession.cells?.find(c => c.id === opSession.primary_cell);
      if (pCell) return pCell.name;
    }
    try { return user?.cell || localStorage.getItem('traceability-cell') || ''; }
    catch { return user?.cell || ''; }
  });
  const selectedCellId = useMemo(() => (
    displayCells.find((cell) => cell.name === cellName || cell.id === cellName)?.id
    || null
  ), [displayCells, cellName]);

  const [shift, setShift] = useState(() => opSession?.shift || currentShift());
  const [machine, setMachine] = useState(null);
  const [contextSyncError, setContextSyncError] = useState(null);
  const shiftRange = useMemo(() => {
    return getShiftRange(shift, new Date(), opSession?.shift_start_time, opSession?.shift_end_time);
  }, [shift, opSession?.shift_start_time, opSession?.shift_end_time]);

  // Garantir que a célula selecionada esteja na lista de células permitidas do operador
  useEffect(() => {
    if (displayCells.length > 0) {
      const isAllowed = displayCells.some(c => c.name === cellName || c.id === cellName);
      if (!isAllowed) {
        setCellName(displayCells[0].name);
      }
    } else if (opSession || user?.role === 'operator') {
      setCellName('');
    }
  }, [displayCells, cellName, opSession, user]);

  // Sincronizar célula e turno quando a sessão operacional mudar
  useEffect(() => {
    if (opSession?.primary_cell) {
      const pCell = opSession.cells?.find(c => c.id === opSession.primary_cell);
      if (pCell) setCellName(pCell.name);
    }
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

  // Carregar Parada Ativa se existir
  const { data: activeDowntime, refetch: refetchActiveDowntime } = useQuery({
    queryKey: ['active-downtime', cellName, machine?.id],
    queryFn: () => getActiveDowntime({ machineId: machine?.id || null, cellId: null }),
    enabled: !!cellName,
    refetchInterval: 10000
  });

  // Filtrar máquinas autorizadas do operador para a célula selecionada
  const displayMachines = useMemo(() => {
    if (!opSession || !opSession.machines?.length) return machines;
    const selectedCellObj = opSession.cells.find(c => c.name === cellName || c.id === cellName);
    if (!selectedCellObj) return [];
    return opSession.machines.filter(m => m.cell_id === selectedCellObj.id);
  }, [opSession, machines, cellName]);
  const selectedMachineId = useMemo(() => (
    machine?.id && displayMachines.some((candidate) => candidate.id === machine.id)
      ? machine.id
      : null
  ), [displayMachines, machine?.id]);

  // Auto-selecionar ou recuperar máquina
  useEffect(() => {
    if (displayMachines.length === 1) {
      setMachine(displayMachines[0]);
    } else if (displayMachines.length > 1) {
      const savedId = sessionStorage.getItem(`selected-machine-id-${cellName}`);
      const savedMachine = displayMachines.find(m => m.id === savedId);
      if (savedMachine) {
        setMachine(savedMachine);
      } else {
        setMachine(null);
      }
    } else {
      setMachine(null);
    }
  }, [displayMachines, cellName]);

  // Sincronizar o contexto da sessão operacional no servidor
  useEffect(() => {
    if (!opSession?.token || !cellName) {
      setContextSyncError(null);
      return undefined;
    }
    const selectedCellObj = displayCells.find(c => c.name === cellName || c.id === cellName);
    if (!selectedCellObj?.id) {
      setContextSyncError('A célula selecionada não está autorizada para este operador.');
      return undefined;
    }

    const desiredMachineId = selectedMachineId;
    if (
      opSession.selected_cell_id === selectedCellObj.id
      && (opSession.selected_machine_id || null) === desiredMachineId
      && opSession.selected_station_name === 'Coletor Chão de Fábrica'
    ) {
      setContextSyncError(null);
      return undefined;
    }

    let cancelled = false;
    setContextSyncError(null);
    const syncContext = async () => {
      try {
        await setOpSessionContext(selectedCellObj.id, desiredMachineId, 'Coletor Chão de Fábrica');
      } catch (err) {
        console.error('Erro ao sincronizar contexto com o servidor:', err);
        if (!cancelled) {
          setContextSyncError(err?.message || 'Não foi possível confirmar o posto operacional.');
        }
      }
    };
    syncContext();
    return () => { cancelled = true; };
  }, [
    opSession?.token,
    opSession?.selected_cell_id,
    opSession?.selected_machine_id,
    opSession?.selected_station_name,
    cellName,
    selectedMachineId,
    displayCells,
    setOpSessionContext,
  ]);

  const collectionContextReady = Boolean(
    opSession?.token
    && selectedCellId
    && opSession.selected_cell_id === selectedCellId
    && (opSession.selected_machine_id || null) === selectedMachineId
    && opSession.selected_station_name === 'Coletor Chão de Fábrica'
    && !contextSyncError
  );
  const collectionContextMessage = contextSyncError
    ? `Coleta bloqueada: ${contextSyncError}`
    : !selectedCellId
      ? 'A célula salva não pertence ao operador. Aguarde a correção automática.'
      : 'Validando a célula e o posto do operador no servidor...';

  const handleMachineChange = (selected) => {
    setMachine(selected);
    if (selected) {
      sessionStorage.setItem(`selected-machine-id-${cellName}`, selected.id);
    } else {
      sessionStorage.removeItem(`selected-machine-id-${cellName}`);
    }
  };

  // KPIs consistentes com a fonte do histórico de coletas
  const { data: kpis = {} } = useQuery({
    queryKey: [
      'collection-kpis',
      cellName,
      machine?.id,
      shift,
      shiftRange.dateFrom,
      shiftRange.dateTo,
      feedback?.lot?.pcp_import_batch_id || null,
    ],
    queryFn: () => getCollectionKpis({
      cellName,
      workstationId: machine?.id || null,
      shift: shift || null,
      dateFrom: shiftRange.dateFrom,
      dateTo: shiftRange.dateTo,
      pcpImportBatchId: feedback?.lot?.pcp_import_batch_id || null,
    }),
    enabled: !!cellName,
    initialData: { total: 0, approved: 0, rejected: 0, blocked: 0 },
    staleTime: 0,
    refetchOnMount: true,
    retry: false,
    refetchInterval: false,
  });

  const { data: shiftKpis = {} } = useQuery({
    queryKey: ['operator-shift-kpis', opSession?.id, shift, shiftRange.dateFrom, shiftRange.dateTo],
    queryFn: () => getOperatorShiftKpisV2(opSession?.id),
    enabled: !!opSession?.id,
    refetchInterval: false,
  });

  const cellStats = {
    expected: Number(kpis.expected) || 0,
    approved: Number(kpis.approved) || 0,
    rejected: Number(kpis.rejected) || 0,
    pending: Number(kpis.pending) || 0,
    rework: Number(kpis.rework) || 0,
    replacement: Number(kpis.replacement) || 0,
  };
  const activeGeneralLots = Array.isArray(kpis.active_general_lots) ? kpis.active_general_lots : [];
  const currentGeneralLot = activeGeneralLots.find(
    (lot) => lot.id === feedback?.lot?.pcp_import_batch_id
  ) || activeGeneralLots[0] || null;
  const currentClientLotCode = feedback?.lot?.lot_code || selectedPiece?.lot_code || null;

  const refreshKpis = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey?.[0] === 'collection-kpis'
        && query.queryKey?.[1] === cellName,
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey?.[0] === 'operator-shift-kpis'
        && query.queryKey?.[1] === opSession?.id,
    });
    queryClient.invalidateQueries({
      queryKey: ['stageReadings', cellName, machine?.id],
    });
  }, [queryClient, cellName, machine?.id, opSession?.id]);

  const refreshData = useCallback(() => {
    refreshKpis();
    setRefreshReadsSignal((value) => value + 1);
  }, [refreshKpis]);

  // Busca silenciosa da timeline da peça ativa
  useEffect(() => {
    if (!selectedPiece?.id && !selectedPiece?.piece_uid) {
      setSelectedPieceEvents([]);
      return;
    }
    let isMounted = true;
    const targetKey = selectedPiece.id || selectedPiece.piece_uid;
    const loadEvents = async () => {
      setLoadingPieceEvents(true);
      try {
        const res = await getPieceTraceability(targetKey);
        if (!isMounted) return;
        setSelectedPieceEvents(res.readings || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (isMounted) setLoadingPieceEvents(false);
      }
    };
    loadEvents();
    return () => { isMounted = false; };
  }, [selectedPiece?.id, selectedPiece?.piece_uid, refreshReadsSignal]);

  // ─── Função que processa um evento da fila ──────────────────────────────────
  const processEvent = useCallback(async (event) => {
    if (event.event_kind !== COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE && !event.cellName && !cellName) {
      throw new Error('Célula não definida.');
    }
    const result = await dispatchCollectionEvent({
      cellName,
      shift,
      operator,
      operatorId,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
      ...event,
    });
    refreshData();
    return result;
  }, [cellName, shift, operator, operatorId, machine, refreshData]);

  const handleQueueResult = useCallback(({
    event,
    result,
    error,
    state: providedState,
  }) => {
    const domainResult = result?.result ?? result?.resultado ?? result ?? {};
    const state = providedState
      || collectionStateFromResult(result)
      || collectionStateFromResult(domainResult)
      || (error ? COLLECTION_STATES.RETRYING : null);
    const clientEventId = event?.client_event_id
      || result?.client_event_id
      || domainResult?.client_event_id
      || null;
    const isLatest = clientEventId
      && clientEventId === latestClientEventIdRef.current;

    if (isLatest && state) {
      updateFeedback({
        ...domainResult,
        client_event_id: clientEventId,
        collection_state: state,
        status: state.toLowerCase(),
        success: state === COLLECTION_STATES.APPROVED,
        alert_level: state === COLLECTION_STATES.APPROVED
          ? 'green'
          : isCollectionTerminalState(state)
            ? (state === COLLECTION_STATES.BLOCKED
              || state === COLLECTION_STATES.DUPLICATED
              || state === COLLECTION_STATES.PENDING_REVIEW
                ? 'yellow'
                : 'red')
            : 'blue',
        message: domainResult?.message
          || error?.message
          || (state === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
            ? 'Registrada no banco. Aguardando validação.'
            : 'Leitura preservada e aguardando processamento.'),
      });
    }

    if (!isCollectionTerminalState(state)) return;
    refreshData();

    const message = domainResult?.message || error?.message;
    if (state === COLLECTION_STATES.APPROVED) {
      toast.success(message || 'Leitura aprovada.', {
        id: `collection-final-${clientEventId}`,
      });
      navigator.vibrate?.([70, 40, 70]);
    } else if ([
      COLLECTION_STATES.BLOCKED,
      COLLECTION_STATES.DUPLICATED,
      COLLECTION_STATES.PENDING_REVIEW,
    ].includes(state)) {
      toast.warning(message || 'Leitura requer atenção.', {
        id: `collection-final-${clientEventId}`,
      });
    } else {
      toast.error(message || 'Leitura não aprovada.', {
        id: `collection-final-${clientEventId}`,
      });
    }

    if (isLatest && domainResult?.item) {
      setSelectedPiece({
        id: domainResult.item.id || domainResult.reading?.piece_id,
        piece_uid: event?.raw_value || domainResult.reading?.tag_value,
        piece_name: domainResult.item.name || domainResult.item.piece_name || 'Peça Lida',
        lot_id: domainResult.lot?.id,
        lot_code: domainResult.lot?.lot_code || 'LOTE-N/A',
        order_number: domainResult.order?.order_number || domainResult.order?.order_code || 'N/A',
        client_name: domainResult.order?.customer_name || 'Cliente não informado',
        current_stage: domainResult.route?.step_name || domainResult.item.current_stage || domainResult.item.current_step,
        current_stage_name: domainResult.route?.step_name || domainResult.item.current_stage || domainResult.item.current_step,
        operator_name: operator,
        status: state.toLowerCase(),
        route: [],
        completedSteps: [],
      });
    }
  }, [operator, refreshData, updateFeedback]);

  // ─── Fila de coleta com filtros ─────────────────────────────────────────────
  const {
    stats: queueStats,
    flushing,
    enqueue,
    processNow,
    retryQueueErrors,
    pipelineV3Enabled,
    realtimeStatus,
    online: collectionOnline,
  } = useCollectionQueue(processEvent, {
    cellName,
    cellId: selectedCellId,
    machineId: machine?.id,
    eventKind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
    operatorId,
    queryClient,
    onResult: handleQueueResult,
  });

  // ─── Handler principal de leitura — enfileira e processa ────────────────────
  const handleRead = useCallback(async (payload) => {
    // Leitores RFID e alguns coletores integrados não disparam eventos de
    // teclado/pointer no navegador; a tentativa de coleta é atividade real.
    recordSessionActivity();

    if (!collectionContextReady) {
      const result = {
        success: false,
        status: 'invalid_context',
        message: collectionContextMessage,
      };
      updateFeedback(result);
      toast.warning(result.message);
      return result;
    }

    if (activeDowntime) {
      const result = { success: false, status: 'blocked', message: 'Coleta bloqueada! Há uma parada ativa na célula/máquina.' };
      updateFeedback(result);
      toast.error('Sistema de coleta bloqueado devido à parada em andamento.');
      return result;
    }
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
      event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
      raw_value: payload.rawValue ?? payload.raw_value ?? '',
      cellName,
      shift,
      operator,
      operatorId,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
      source_mode: collectionOnline ? 'live' : 'offline_replay',
      quantity: Math.max(1, Number(payload.quantity) || 1),
    };

    const clientEventId = await enqueue(eventPayload, { autoFlush: false });
    latestClientEventIdRef.current = clientEventId;
    updateFeedback({
      success: false,
      status: 'captured_local',
      collection_state: COLLECTION_STATES.CAPTURED_LOCAL,
      alert_level: 'blue',
      client_event_id: clientEventId,
      message: collectionOnline
        ? 'Leitura capturada.'
        : 'Salva neste equipamento — aguardando sincronização.',
    });

    if (collectionOnline) {
      try {
        const result = await processNow(clientEventId);
        updateFeedback({ ...result, client_event_id: clientEventId });

        if (result?.pending || result?.status === 'queued') {
          toast.info(
            result.message || 'Leitura recebida e aguardando validação.',
            { id: 'collection-local-accepted' },
          );
          return result;
        }

        if (result?.success) {
          toast.success(result.message || 'Leitura aprovada');
          navigator.vibrate?.([70, 40, 70]);
        } else if (['wrong_step', 'wrong_cell', 'duplicated'].includes(result?.status)) {
          toast.warning(result.message || 'Leitura bloqueada');
        } else {
          toast.error(result?.message || 'Leitura não aprovada');
        }

        // Auto-seleciona a peça recém-lida para exibir o fluxo à direita
        const uid = eventPayload.raw_value;
        const tempPiece = {
          id: result.item?.id || result.reading?.piece_id,
          piece_uid: uid,
          piece_name: result.item?.name || result.item?.piece_name || 'Peça Lida',
          lot_id: result.lot?.id,
          lot_code: result.lot?.lot_code || 'LOTE-N/A',
          order_number: result.order?.order_number || result.order?.order_code || 'N/A',
          client_name: result.order?.customer_name || 'Cliente não informado',
          current_stage: result.route?.step_name || result.item?.current_stage || result.item?.current_step,
          current_stage_name: result.route?.step_name || result.item?.current_stage || result.item?.current_step,
          operator_name: operator,
          status: result.status || 'approved',
          route: [],
          completedSteps: []
        };
        setSelectedPiece(tempPiece);

        return result;
      } catch (error) {
        const result = {
          success: false,
          status: 'retrying',
          collection_state: COLLECTION_STATES.RETRYING,
          alert_level: 'blue',
          client_event_id: clientEventId,
          message: error?.message || 'Leitura enfileirada para reenvio.',
        };
        updateFeedback(result);
        toast.warning('Leitura preservada. O reenvio será feito automaticamente.');
        return result;
      }
    } else {
      toast.info('Sem conexão. Leitura salva na fila local.');
      const result = {
        success: false,
        status: 'captured_local',
        collection_state: COLLECTION_STATES.CAPTURED_LOCAL,
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Salva neste equipamento — aguardando sincronização.',
      };
      updateFeedback(result);
      return result;
    }
  }, [cellName, shift, operator, operatorId, machine, collectionOnline, enqueue, processNow, updateFeedback, activeDowntime, collectionContextReady, collectionContextMessage]);

  // Aberturas de modais operacionais
  const handleOpenRejectModal = (piece) => {
    if (!piece) return;
    const targetPiece = typeof piece === 'string'
      ? { piece_uid: piece, id: piece, piece_name: 'Peça Lida' }
      : piece;
    setPieceToReject({
      ...targetPiece,
      rejection_client_event_id: targetPiece.rejection_client_event_id || crypto.randomUUID(),
    });
    setRejectModalOpen(true);
  };

  const handleOpenTraceabilityDrawer = (piece) => {
    if (!piece) return;
    const code = typeof piece === 'string'
      ? piece
      : (piece.piece_uid || piece.traceability_code || piece.piece_code || piece.tag_value || piece.raw_value || piece.id || piece.piece_id);
    if (!code) {
      toast.error('Código ou ID da peça não localizado para rastreabilidade.');
      return;
    }
    setTraceabilityCodeForDrawer(code);
    setTraceabilityOpen(true);
  };

  const handleRejectPieceSubmit = async (formData) => {
    if (!pieceToReject) return;
    setRejecting(true);
    try {
      const code = typeof pieceToReject === 'string'
        ? pieceToReject
        : (pieceToReject.piece_uid || pieceToReject.traceability_code || pieceToReject.piece_code || pieceToReject.tag_value || pieceToReject.raw_value || pieceToReject.id || pieceToReject.piece_id);

      const resolvedPieceId = typeof pieceToReject === 'string'
        ? null
        : (pieceToReject.piece_id || pieceToReject.id);

      const result = await rejectPieceFromCollection({
        pieceId: resolvedPieceId,
        traceabilityCode: code,
        reason: formData.reason,
        notes: formData.notes,
        action: formData.action,
        defectId: formData.defect_id,
        defectCode: formData.defect_code,
        defectName: formData.defect_name,
        sixMCategory: formData.six_m_category,
        severity: formData.severity,
        disposition: formData.disposition,
        requiresReplacement: formData.requires_replacement,
        operatorId,
        operatorName: operator,
        cellName,
        workstationId: machine?.id || null,
        clientEventId: pieceToReject.rejection_client_event_id,
      });

      const canonical = await getPieceTraceability(result?.piece_id || pieceToReject.piece_id || pieceToReject.id || code);
      setSelectedPieceEvents(canonical.readings || []);
      setSelectedPiece((previous) => mergeCanonicalPiece(previous || pieceToReject, canonical));

      toast.success(result?.idempotent ? 'A reprovação já estava registrada.' : 'Reprovação registrada com sucesso.');
      setRejectModalOpen(false);
      setPieceToReject(null);
      setRefreshReadsSignal((value) => value + 1);
      refreshData();
    } catch (error) {
      console.error('Erro ao registrar reprovação:', error);
      toast.error(error?.message || 'Falha ao registrar reprovação.');
    } finally {
      setRejecting(false);
    }
  };

  const handleRequestReplacement = async (piece) => {
    if (!piece) return;
    const reason = prompt('Informe o motivo da reposição (ex: Riscos, Peça Empenada, Erro de furação):', 'Peça danificada no processo');
    if (!reason || reason.trim() === '') return;
    
    try {
      const res = await requestPieceReplacement({
        pieceId: piece.piece_id || piece.id,
        reason: reason.trim(),
        notes: `Solicitado via painel de coleta pelo operador ${operator}`
      });
      
      toast.success(
        `✅ Ordem de Reposição criada! Código: ${res?.replacement_code || 'REP gerada'}. Acompanhe em /reposicao.`
      );
      setRefreshReadsSignal(prev => prev + 1);
      refreshData();
      
      // ⚠️ A peça permanece com status 'rejected' no histórico até que a baixa seja dada em /reposicao.
      // NÃO alterar o status aqui para 'replaced' — só a RPC complete_piece_replacement deve fazer isso.
      if (selectedPiece && selectedPiece.id === piece.id) {
        setSelectedPiece(prev => prev ? {
          ...prev,
          replacement_status: 'requested',
          replacement_code: res?.replacement_code
        } : null);
      }
    } catch (error) {
      toast.error(error?.message || 'Falha ao solicitar reposição da peça.');
    }
  };

  const handleOpenReadingOccurrence = useCallback((reading) => {
    const now = new Date();
    const readingStatus = reading.event_status || reading.status;
    setReadingOccurrenceSuggestion({
      type: readingStatus === 'rejected' ? 'quality' : 'low_efficiency',
      cell: reading.cell_name || cellName,
      cell_name: reading.cell_name || cellName,
      shift: reading.shift || shift,
      date: reading.date || now.toISOString().slice(0, 10),
      operator: reading.operator || operator,
      stage_reading_id: reading.reading_id || null,
      tag_value: reading.traceability_code || reading.raw_value || reading.tag_value,
      lot_id: reading.lot_id || null,
      lot_code: reading.lot_code || null,
      severity: readingStatus === 'rejected' ? 'high' : 'medium',
      reason: readingStatus === 'rejected' ? 'Qualidade / Refugo' : 'Outros',
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

  const pageClass = embedded ? 'space-y-5' : 'p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6';

  const isAnyModalOpen = traceabilityOpen || rejectModalOpen || downtimeDialogOpen || readingOccurrenceOpen || kioskOpen;

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
      contextReady={collectionContextReady}
      contextMessage={collectionContextMessage}
      modalOpen={isAnyModalOpen}
      onOpenDowntime={() => setDowntimeDialogOpen(true)}
      onToggleKiosk={() => setKioskOpen(true)}
      activeDowntime={activeDowntime}
      volumeEntry={(
        <CollectionVolumeEntryPanel
          cellName={cellName}
          shift={shift}
          operator={operator}
          disabled={Boolean(activeDowntime) || !collectionContextReady}
          disabledReason={activeDowntime
            ? `Parada ativa: ${activeDowntime.reason || 'Parada operacional'}. Encerre a parada antes de contabilizar o volume.`
            : !collectionContextReady
              ? collectionContextMessage
              : ''}
          onSuccess={(result) => {
            recordSessionActivity();
            refreshData();
            updateFeedback({
              success: true,
              status: 'manual_volume',
              alert_level: 'blue',
              message: result.batch_completed
                ? `Lote Geral ${result.general_lot_code} concluído por contabilização de volume.`
                : `${result.quantity} peça(s) contabilizada(s) em ${result.cell_name}. Saldo da etapa: ${result.remaining_after}.`,
            });
          }}
        />
      )}
      readerContext={currentGeneralLot?.general_lot_code ? (
        <div
          data-testid="collection-lot-banner"
          className="rounded-2xl border-2 border-emerald-600 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-800 px-5 py-4 text-white shadow-lg shadow-emerald-950/15"
        >
          <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-200">Lote geral em coleta</p>
              <p className="mt-1 font-mono text-4xl font-black leading-none tracking-wider sm:text-5xl">
                {currentGeneralLot.general_lot_code}
              </p>
            </div>
            <div className="border-emerald-500/40 sm:border-l sm:pl-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-200">Lote do cliente</p>
              <p className="mt-1 font-mono text-2xl font-extrabold">
                {currentClientLotCode || 'Aguardando leitura'}
              </p>
              {feedback?.order?.customer_name && (
                <p className="mt-1 truncate text-xs font-medium text-emerald-100">{feedback.order.customer_name}</p>
              )}
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-left sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">Andamento geral</p>
              <p className="mt-1 text-2xl font-black tabular-nums">
                {Number(currentGeneralLot.progress_percent || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%
              </p>
            </div>
          </div>
        </div>
      ) : null}
    />
  ), [
    mode,
    handleRead,
    feedback,
    cellName,
    shift,
    operator,
    machine,
    collectionContextReady,
    collectionContextMessage,
    currentGeneralLot,
    currentClientLotCode,
    activeDowntime,
    refreshData,
    updateFeedback,
  ]);

  const isCellLocked = !!(opSession && opSession.cells?.length <= 1);

  return (
    <div className={pageClass}>
      {!embedded && (
        <PageHeader 
          title="Coleta / Bipagem" 
          subtitle="Estação de controle operacional de coleta — bipagem por código de barras, QR Code ou RFID." 
          icon={ScanLine} 
        />
      )}

      {/* Contexto de coleta (célula, máquina, turno, operador) */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start bg-card border border-border rounded-2xl p-4">
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-cell" className="text-xs font-semibold text-muted-foreground">Célula da coleta</label>
          <select
            id="traceability-cell"
            value={cellName}
            onChange={(e) => setCellName(e.target.value)}
            disabled={cellsLoading || isCellLocked}
            className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 font-medium"
            required
          >
            <option value="">{cellsLoading ? 'Carregando células...' : displayCells.length ? 'Selecione a célula' : 'Nenhuma célula ativa'}</option>
            {displayCells.map((cell) => <option key={cell.id} value={cell.name}>{cell.name}</option>)}
          </select>
          {isCellLocked && <p className="text-[11px] text-muted-foreground">Célula definida pelo login operacional.</p>}
        </div>

        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-machine" className="text-xs font-semibold text-muted-foreground">Máquina / Posto</label>
          <select
            id="traceability-machine"
            value={machine?.id || ''}
            onChange={(e) => {
              const selected = displayMachines.find(m => m.id === e.target.value);
              handleMachineChange(selected || null);
            }}
            disabled={machinesLoading || !cellName}
            className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 font-medium"
          >
            <option value="">{machinesLoading ? 'Carregando máquinas...' : displayMachines.length ? 'Todas as máquinas' : 'Nenhuma máquina cadastrada'}</option>
            {displayMachines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-shift" className="text-xs font-semibold text-muted-foreground">Turno</label>
          <select
            id="traceability-shift"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
          >
            {['1º Turno', '2º Turno', '3º Turno'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 flex-1">
          <label className="text-xs font-semibold text-muted-foreground">Operador</label>
          <div className="h-10 rounded-xl border border-input bg-secondary/50 px-3 flex items-center text-sm font-medium truncate">
            {operator || 'Não identificado'}
          </div>
        </div>
      </div>

      {/* Painel de status da fila */}
      <CollectionQueuePanel
        stats={queueStats}
        flushing={flushing}
        onRetry={retryQueueErrors}
        online={collectionOnline}
      />

      {/* Detalhamento de Peças da Estação / Célula */}
      {cellName && (
        <div className="space-y-4">
          {/* Painel de Integridade da Estação */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center pb-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Painel de Integridade da Estação: {cellName}
              </h4>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${
                  collectionOnline && (!pipelineV3Enabled || realtimeStatus === 'SUBSCRIBED')
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-slate-400'
                }`} />
                <span className="text-xs text-muted-foreground font-medium">
                  {!collectionOnline
                    ? 'Offline — leituras preservadas localmente'
                    : pipelineV3Enabled && realtimeStatus !== 'SUBSCRIBED'
                      ? 'Reconciliação segura ativa'
                      : 'Monitoramento em Tempo Real'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-secondary/10 border border-border/30 rounded-xl p-3">
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Previsto</p>
                <p className="text-xl font-extrabold text-foreground mt-1 tabular-nums">{cellStats.expected}</p>
              </div>
              <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3">
                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Aprovado</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1 tabular-nums">{cellStats.approved}</p>
              </div>
              <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-3">
                <p className="text-[10px] text-rose-600 font-bold uppercase tracking-wider">Reprovado</p>
                <p className="text-xl font-extrabold text-rose-600 mt-1 tabular-nums">{cellStats.rejected}</p>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">Pendente</p>
                <p className="text-xl font-extrabold text-amber-600 mt-1 tabular-nums">{cellStats.pending}</p>
              </div>
              <div className="bg-purple-500/5 border border-purple-500/10 rounded-xl p-3">
                <p className="text-[10px] text-purple-600 font-bold uppercase tracking-wider">Retrabalho</p>
                <p className="text-xl font-extrabold text-purple-600 mt-1 tabular-nums">{cellStats.rework}</p>
              </div>
              <div className="bg-sky-500/5 border border-sky-500/10 rounded-xl p-3">
                <p className="text-[10px] text-sky-600 font-bold uppercase tracking-wider">Reposição</p>
                <p className="text-xl font-extrabold text-sky-600 mt-1 tabular-nums">{cellStats.replacement}</p>
              </div>
            </div>
          </div>

          {/* Segunda linha: Leituras do Turno, Aprovadas, Reprovadas, Bloqueadas */}
          <TraceabilityKpiCards kpis={{
            ...kpis,
            ...shiftKpis,
            total: (shiftKpis.approved || 0) + (shiftKpis.rejected || 0) + (shiftKpis.blocked || 0),
          }} />
        </div>
      )}

      {/* Banner de Parada Ativa se existir */}
      {activeDowntime && (
        <ActiveDowntimeBanner
          activeDowntime={activeDowntime}
          onDowntimeFinished={() => {
            refetchActiveDowntime();
            refreshData();
          }}
        />
      )}

      {/* Scanner Área */}
      {scanner}

      {/* 2 Colunas: Últimas leituras da célula e Detalhe da peça selecionada */}
      <div className="grid md:grid-cols-2 gap-6 items-stretch">
        <div className="h-full">
          <CollectionRecentReadsPanel
            cellId={selectedCellId}
            cellName={cellName}
            workstationId={machine?.id}
            operatorId={operatorId}
            shift={shift}
            selectedPiece={selectedPiece}
            onSelectPiece={setSelectedPiece}
            onRejectPiece={handleOpenRejectModal}
            onCreateOccurrence={handleOpenReadingOccurrence}
            onOpenTraceability={handleOpenTraceabilityDrawer}
            refreshSignal={refreshReadsSignal}
            canReject={true}
          />
        </div>

        <div className="h-full">
          <CollectionPieceDetailPanel
            piece={selectedPiece}
            events={selectedPieceEvents}
            loading={loadingPieceEvents}
            onReject={handleOpenRejectModal}
            onOpenTraceability={handleOpenTraceabilityDrawer}
            onRefresh={() => setRefreshReadsSignal(prev => prev + 1)}
            onReplacement={handleRequestReplacement}
            canReject={true}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between pt-2">
        <RfidReadinessPanel />
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <RadioTower className="w-4 h-4" />
        Câmeras exigem HTTPS em produção. Scanner físico e modo manual continuam disponíveis sem câmera.
      </div>

      {/* Modais e Dialogs */}
      <CollectionRejectPieceModal
        open={rejectModalOpen}
        onOpenChange={(open) => {
          setRejectModalOpen(open);
          if (!open && !rejecting) setPieceToReject(null);
        }}
        piece={pieceToReject}
        onSubmit={handleRejectPieceSubmit}
        loading={rejecting}
      />

      <CollectionPieceTraceabilityDrawer
        open={traceabilityOpen}
        onOpenChange={setTraceabilityOpen}
        pieceCode={traceabilityCodeForDrawer}
        canReject={true}
        onReject={handleOpenRejectModal}
      />

      <OccurrenceQuickDialog
        open={readingOccurrenceOpen}
        onOpenChange={setReadingOccurrenceOpen}
        suggestion={readingOccurrenceSuggestion}
        onSubmit={handleReadingOccurrenceSubmit}
        loading={readingOccurrenceLoading}
      />

      <DowntimeDialog
        open={downtimeDialogOpen}
        onOpenChange={setDowntimeDialogOpen}
        cellId={displayCells.find(c => c.name === cellName)?.id || null}
        cellName={cellName}
        machineId={machine?.id || null}
        operatorId={operatorId}
        operatorName={operator}
        shift={shift}
        onDowntimeStarted={() => {
          refetchActiveDowntime();
          refreshData();
        }}
      />

      <CollectionErrorBoundary onReset={() => setKioskOpen(false)}>
        <CollectionFullscreenKiosk
          open={kioskOpen}
          onClose={() => setKioskOpen(false)}
          cellName={cellName}
          cellId={selectedCellId}
          machine={machine}
          shift={shift}
          operator={operator}
          operatorId={operatorId}
          mode={mode}
          setMode={setMode}
          handleRead={handleRead}
          feedback={feedback}
          cellStats={cellStats}
          currentGeneralLot={currentGeneralLot}
          currentClientLotCode={currentClientLotCode}
          activeDowntime={activeDowntime}
          refetchActiveDowntime={refetchActiveDowntime}
          refreshData={refreshData}
          onOpenDowntime={() => setDowntimeDialogOpen(true)}
          selectedPiece={selectedPiece}
          onSelectPiece={setSelectedPiece}
          handleOpenRejectModal={handleOpenRejectModal}
          handleOpenReadingOccurrence={handleOpenReadingOccurrence}
          handleOpenTraceabilityDrawer={handleOpenTraceabilityDrawer}
          refreshReadsSignal={refreshReadsSignal}
          contextReady={collectionContextReady}
          contextMessage={collectionContextMessage}
        />
      </CollectionErrorBoundary>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, RefreshCw, AlertCircle, Filter, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getCollectionHistory,
  getCollectionHistoryCount,
  subscribeToCollectionHistory,
  unsubscribeFromCollectionHistory,
} from '@/lib/collectionService';
import CollectionReadItem from './CollectionReadItem';
import { scheduleCollectionQueryInvalidation } from '@/hooks/collectionQueryInvalidation';
import { resolveCollectionSnapshotAfterLocalUpdates, scheduleCollectionCounterReconciliation } from '@/hooks/collectionCounterReconciliation';

export const COLLECTION_HISTORY_FALLBACK_MIN_MS = 60_000;
export const COLLECTION_HISTORY_FALLBACK_MAX_MS = 90_000;

const TERMINAL_HISTORY_STATUSES = new Set([
  'approved',
  'approved_via_replacement',
  'rejected',
  'blocked',
  'duplicated',
  'pending_review',
  'dead_lettered',
  'error',
  'invalid',
  'not_found',
]);

export function getCollectionHistoryFallbackDelay(randomValue = Math.random()) {
  const numericValue = Number(randomValue);
  const boundedValue = Number.isFinite(numericValue)
    ? Math.min(1, Math.max(0, numericValue))
    : 0;
  return COLLECTION_HISTORY_FALLBACK_MIN_MS + Math.round(
    (COLLECTION_HISTORY_FALLBACK_MAX_MS - COLLECTION_HISTORY_FALLBACK_MIN_MS)
      * boundedValue,
  );
}

// O painel normal continua montado por baixo do modo foco. Um agendador por
// QueryClient + filtro garante que as duas visualizações compartilhem a mesma
// reconciliação, em vez de abrirem dois ciclos HTTP independentes.
const historyFallbackSchedulers = new WeakMap();

function subscribeToSharedHistoryFallback(queryClient, queryKey, callback) {
  let clientSchedulers = historyFallbackSchedulers.get(queryClient);
  if (!clientSchedulers) {
    clientSchedulers = new Map();
    historyFallbackSchedulers.set(queryClient, clientSchedulers);
  }

  const scopeKey = JSON.stringify(queryKey);
  let scheduler = clientSchedulers.get(scopeKey);
  if (!scheduler) {
    scheduler = {
      callbacks: new Set(),
      timer: null,
      stopped: false,
    };
    clientSchedulers.set(scopeKey, scheduler);

    const scheduleNext = () => {
      if (scheduler.stopped || scheduler.timer !== null || !scheduler.callbacks.size) return;
      scheduler.timer = window.setTimeout(() => {
        scheduler.timer = null;
        if (scheduler.stopped || !scheduler.callbacks.size) return;
        if (navigator.onLine !== false && document.visibilityState !== 'hidden') {
          // Todas as inscrições deste scheduler observam a mesma queryKey.
          // Uma callback invalida a query compartilhada para todos os painéis.
          scheduler.callbacks.values().next().value?.();
        }
        scheduleNext();
      }, getCollectionHistoryFallbackDelay());
    };
    scheduler.scheduleNext = scheduleNext;
  }

  scheduler.callbacks.add(callback);
  scheduler.scheduleNext();

  return () => {
    scheduler.callbacks.delete(callback);
    if (scheduler.callbacks.size) return;
    scheduler.stopped = true;
    if (scheduler.timer !== null) window.clearTimeout(scheduler.timer);
    scheduler.timer = null;
    clientSchedulers.delete(scopeKey);
  };
}

function normalizeRealtimeHistoryStatus(row) {
  const payload = row?.result_payload || {};
  const status = String(
    row?.result_status
      || payload.status
      || payload.result?.status
      || row?.status
      || '',
  ).trim().toLowerCase();
  const entryType = row?.entry_type || payload.entry_type
    || payload.source || payload.result?.entry_type;

  if (status === 'approved'
    && ['baixa_reposicao', 'replacement_approval'].includes(entryType)) {
    return 'approved_via_replacement';
  }
  if (['wrong_step', 'wrong_cell', 'warning'].includes(status)) return 'blocked';
  if (status === 'duplicate') return 'duplicated';
  return status;
}

/**
 * Converte o snapshot completo de Postgres Changes no mesmo formato básico da
 * RPC de histórico. Somente estados terminais entram no cache: INSERT e UPDATE
 * do mesmo evento tornam-se um único item, sem abrir outro GET ou COUNT.
 */
export function collectionHistoryRowFromRealtimePayload(payload = {}) {
  const row = payload.new || null;
  if (!row) return null;
  const eventStatus = normalizeRealtimeHistoryStatus(row);
  if (!TERMINAL_HISTORY_STATUSES.has(eventStatus)) return null;

  const resultPayload = row.result_payload || {};
  const createdAt = row.created_at_client || row.occurred_at || row.created_at;
  const eventId = row.id || row.event_id || null;
  if (!eventId && !row.client_event_id) return null;

  return {
    ...row,
    id: eventId || row.client_event_id,
    event_id: eventId,
    created_at: createdAt,
    server_created_at: row.created_at || createdAt,
    traceability_code: row.piece_code || row.normalized_value || row.raw_value,
    pcp_batch_name: row.general_lot_code || resultPayload.general_lot_code || null,
    client_name: row.customer_name || resultPayload.customer_name || null,
    current_stage_name: row.operation_name
      || resultPayload.route?.step_name
      || resultPayload.result?.route?.step_name
      || row.cell_name,
    operator_name: row.operator_name || row.operator_name_snapshot || null,
    registration: row.registration || row.operator_registration_snapshot || null,
    machine_name: row.machine_name || row.machine_name_snapshot || null,
    station_name: row.station_name || row.station_name_snapshot || null,
    shift: row.shift || row.shift_snapshot || null,
    event_status: eventStatus,
    reading_status: eventStatus,
    sync_status: row.status,
    message: resultPayload.message || resultPayload.result?.message || row.error_message || null,
    result_payload: resultPayload,
    route_steps: resultPayload.route_steps || [],
    completed_steps: resultPayload.completed_steps || [],
  };
}

function isRealtimeRowInPanelScope(row, {
  cellId,
  cellName,
  workstationId,
  operatorId,
  shift,
  machineScope,
  operatorScope,
  shiftScope,
  period,
  statusFilter,
}) {
  if (cellId && row.cell_id && String(row.cell_id) !== String(cellId)) return false;
  if (cellName && row.cell_name
    && String(row.cell_name).trim().toLowerCase() !== String(cellName).trim().toLowerCase()) return false;
  if (machineScope === 'current' && workstationId
    && String(row.machine_id || '') !== String(workstationId)) return false;
  if (operatorScope === 'mine' && operatorId
    && String(row.operator_id || '') !== String(operatorId)) return false;
  if (shiftScope === 'current' && shift && String(row.shift || '') !== String(shift)) return false;

  if (statusFilter !== 'all') {
    const matchesStatus = statusFilter === 'approved'
      ? ['approved', 'approved_via_replacement'].includes(row.event_status)
      : row.event_status === statusFilter;
    if (!matchesStatus) return false;
  }

  const occurredAt = Date.parse(row.created_at);
  if (Number.isFinite(occurredAt) && period !== 'all') {
    const periodMs = period === '24h' ? 24 * 60 * 60 * 1000
      : period === '7days' ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    if (occurredAt < Date.now() - periodMs) return false;
  }
  return true;
}

function mergeDefinedValues(previous, next) {
  const defined = Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
  return { ...previous, ...defined };
}

function getDateRange(selectedPeriod) {
  const now = new Date();
  let dateFrom = null;
  const dateTo = now.toISOString();

  if (selectedPeriod === '24h') {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    dateFrom = d.toISOString();
  } else if (selectedPeriod === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    dateFrom = d.toISOString();
  } else if (selectedPeriod === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    dateFrom = d.toISOString();
  }
  return { dateFrom, dateTo };
}

export default function CollectionRecentReadsPanel({
  cellId,
  cellName,
  workstationId,
  operatorId,
  shift,
  selectedPiece,
  onSelectPiece,
  onRejectPiece,
  onCreateOccurrence,
  onOpenTraceability,
  refreshSignal = 0,
  canReject = false,
  realtimeEnabled = true,
  periodicReconciliationEnabled = true,
  refetchOnMount = true,
  localResultGenerationRef,
}) {
  const [limit, setLimit] = useState(50);
  const queryClient = useQueryClient();
  const ownGenerationRef = useRef(0);
  const generationRef = localResultGenerationRef || ownGenerationRef;

  // Filtros Locais adicionais
  const [period, setPeriod] = useState('24h'); // 24h, 7days, month, all
  const [statusFilter, setStatusFilter] = useState('all'); // all, approved, rejected, blocked
  const [operatorScope, setOperatorScope] = useState('cell'); // cell, mine
  const [shiftScope, setShiftScope] = useState('current'); // all, current
  const [machineScope, setMachineScope] = useState('cell'); // cell, current
  const [realtimeStatus, setRealtimeStatus] = useState(
    navigator.onLine ? (realtimeEnabled ? 'connecting' : 'polling') : 'offline',
  );
  const previousRefreshSignalRef = useRef(refreshSignal);
  const queryKey = useMemo(() => [
    'stageReadings',
    cellName,
    machineScope === 'current' ? (workstationId || null) : null,
    cellId || null,
    operatorScope === 'mine' ? (operatorId || null) : null,
    shiftScope === 'current' ? (shift || null) : null,
    period,
    statusFilter,
    limit,
  ], [cellName, machineScope, workstationId, cellId, operatorScope, operatorId, shiftScope, shift, period, statusFilter, limit]);

  // O histórico passa a compartilhar o cache e a mesma janela de atualização
  // dos KPIs. Sinal local, Realtime, fallback e modo foco não abrem GETs
  // concorrentes para os mesmos filtros nem exibem resposta de filtro antigo.
  const { data, isFetching: loading, isError } = useQuery({
    queryKey,
    enabled: Boolean(cellName),
    // O painel duplicado do modo foco observa exatamente o mesmo cache da
    // tela normal. Nesse caso, montar a segunda visualização não deve abrir
    // outro GET+COUNT; uma ausência real de cache ainda executa o queryFn.
    refetchOnMount,
    retry: false,
    queryFn: async () => {
      const startedGeneration = generationRef.current;
      const { dateFrom, dateTo } = getDateRange(period);
      const activeStatus = statusFilter === 'all' ? null : statusFilter;
      const filters = {
        cellId: cellId || null,
        cellName,
        // O histórico da célula deve incluir leituras feitas com "Todas as
        // máquinas" (machine_id nulo). A máquina só restringe quando o
        // usuário escolhe explicitamente esse escopo neste painel.
        workstationId: machineScope === 'current' ? (workstationId || null) : null,
        operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
        shift: shiftScope === 'current' ? (shift || null) : null,
        status: activeStatus,
        limit,
        offset: 0,
        dateFrom,
        dateTo,
      };

      const [readings, totalCount] = await Promise.all([
        getCollectionHistory(filters),
        getCollectionHistoryCount(filters),
      ]);
      return resolveCollectionSnapshotAfterLocalUpdates({
        queryClient, queryKey, startedGeneration,
        currentGeneration: generationRef.current, snapshot: { readings, totalCount },
      });
    },
  });
  useEffect(() => {
    if (data?.counter_reconciliation_required) {
      scheduleCollectionCounterReconciliation(queryClient, queryKey);
    }
  }, [data?.counter_reconciliation_required, queryClient, queryKey]);
  const readings = data?.readings || [];
  const totalCount = data?.totalCount || 0;
  const error = isError ? 'Falha ao carregar o histórico de coletas do banco.' : null;
  const refreshHistory = useCallback(() => {
    scheduleCollectionQueryInvalidation(queryClient, { queryKey });
  }, [queryClient, queryKey]);

  const fetchReadings = useCallback(() => {
    refreshHistory();
    // A reconciliação periódica confirma histórico, KPIs e contexto de lote em
    // uma única janela compartilhada, sem consulta acionada por evento.
    scheduleCollectionQueryInvalidation(
      queryClient,
      { queryKey: ['collection-kpis', cellName] },
      JSON.stringify(['collection-kpis-fallback', cellName]),
    );
    if (operatorId) {
      scheduleCollectionQueryInvalidation(
        queryClient,
        { queryKey: ['operator-shift-kpis', operatorId] },
        JSON.stringify(['operator-shift-kpis-fallback', operatorId]),
      );
    }
  }, [cellName, operatorId, queryClient, refreshHistory]);

  const applyRealtimeHistoryEvent = useCallback((payload) => {
    const incoming = collectionHistoryRowFromRealtimePayload(payload);
    if (!incoming) return;
    generationRef.current += 1;

    const inScope = isRealtimeRowInPanelScope(incoming, {
      cellId,
      cellName,
      workstationId,
      operatorId,
      shift,
      machineScope,
      operatorScope,
      shiftScope,
      period,
      statusFilter,
    });

    queryClient.setQueryData(queryKey, (current) => {
      // O GET inicial continua autoritativo. Se ainda não existe fotografia no
      // cache, a reconciliação periódica absorverá o evento sem cancelar esse GET.
      if (!current) return current;
      const currentRows = Array.isArray(current.readings) ? current.readings : [];
      const incomingKey = incoming.event_id || incoming.id || incoming.client_event_id;
      const index = currentRows.findIndex((row) => (
        (row.event_id || row.id || row.client_event_id) === incomingKey
        || (row.client_event_id && row.client_event_id === incoming.client_event_id)
      ));

      if (!inScope) {
        if (index < 0) return current;
        return {
          readings: currentRows.filter((_, rowIndex) => rowIndex !== index),
          totalCount: Math.max(0, Number(current.totalCount || 0) - 1),
        };
      }

      const nextRows = [...currentRows];
      if (index >= 0) nextRows[index] = mergeDefinedValues(nextRows[index], incoming);
      else nextRows.unshift(incoming);
      nextRows.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

      return {
        readings: nextRows.slice(0, limit),
        totalCount: Number(current.totalCount || 0) + (index < 0 ? 1 : 0),
      };
    });
  }, [
    cellId,
    cellName,
    generationRef,
    limit,
    machineScope,
    operatorId,
    operatorScope,
    period,
    queryClient,
    queryKey,
    shift,
    shiftScope,
    statusFilter,
    workstationId,
  ]);

  // Recarrega quando filtros, limit ou sinal mudar
  useEffect(() => {
    if (previousRefreshSignalRef.current === refreshSignal) return;
    previousRefreshSignalRef.current = refreshSignal;
    // A página central já invalidou KPIs e turno; este sinal cobre somente o
    // histórico e evita abrir uma segunda rodada para as mesmas famílias.
    refreshHistory();
  }, [refreshHistory, refreshSignal]);

  // Postgres Changes é opcional. No plano gratuito a coleta opera com HTTP,
  // pois mil estações ultrapassariam o limite de conexões WebSocket. Quando o
  // canal está ativo, o evento terminal é aplicado no cache sem novo GET.
  useEffect(() => {
    if (!cellName) return;

    if (!realtimeEnabled) {
      setRealtimeStatus(navigator.onLine ? 'polling' : 'offline');
      return undefined;
    }

    setRealtimeStatus(navigator.onLine ? 'connecting' : 'offline');
    const channel = subscribeToCollectionHistory({
      cellId,
      cellName,
      channelSuffix: 'panel',
      callback: applyRealtimeHistoryEvent,
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('online');
        }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('offline');
        else setRealtimeStatus('connecting');
      },
    });

    return () => {
      unsubscribeFromCollectionHistory(channel);
    };
  }, [applyRealtimeHistoryEvent, cellId, cellName, realtimeEnabled]);

  // Reconciliação HTTP de segurança para usos isolados do painel. Na tela
  // principal ela é desativada, pois a página possui um único ciclo central
  // para histórico, KPIs, turno e contexto.
  useEffect(() => {
    if (!cellName || !periodicReconciliationEnabled) return undefined;

    const reconcileVisibleOnline = () => {
      if (navigator.onLine === false || document.visibilityState === 'hidden') return;
      fetchReadings();
    };
    const onOffline = () => setRealtimeStatus('offline');
    const onOnline = () => {
      setRealtimeStatus(realtimeEnabled ? 'connecting' : 'polling');
      reconcileVisibleOnline();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconcileVisibleOnline();
    };

    window.addEventListener('focus', reconcileVisibleOnline);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribeFallback = subscribeToSharedHistoryFallback(queryClient, queryKey, fetchReadings);
    return () => {
      unsubscribeFallback();
      window.removeEventListener('focus', reconcileVisibleOnline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    cellName,
    fetchReadings,
    periodicReconciliationEnabled,
    queryClient,
    queryKey,
    realtimeEnabled,
  ]);

  const handleSelect = (read) => {
    if (!read.piece_id) return;
    // Mapeia o item de leitura para o painel de detalhes
    const pieceDetail = {
      id: read.piece_id || read.id,
      piece_uid: read.traceability_code,
      piece_name: read.piece_name || 'Peça Avulsa',
      lot_id: read.lot_id,
      lot_code: read.lot_code,
      order_number: read.order_number,
      client_name: read.client_name,
      current_stage: read.piece_current_stage || read.current_stage_name,
      current_stage_name: read.piece_current_stage || read.current_stage_name,
      operator_name: read.operator_name,
      status: read.piece_status || read.event_status,
      reading_status: read.reading_status || read.result_status,
      replacement_status: read.replacement_status || 'none',
      route: read.route_steps || [],
      completedSteps: read.completed_steps || []
    };
    onSelectPiece(pieceDetail);
  };

  const handleLoadMore = () => {
    setLimit(prev => prev + 50);
  };

  if (!cellName) {
    return (
      <div className="bg-card border border-border/60 rounded-2xl p-6 text-center py-20 text-muted-foreground flex flex-col items-center justify-center space-y-2">
        <Layers className="w-10 h-10 text-muted-foreground/30" />
        <p className="font-bold text-foreground text-sm">Célula não selecionada</p>
        <p className="text-xs text-muted-foreground max-w-[280px]">
          Selecione uma célula na barra superior para carregar o histórico de coletas MES correspondente.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 flex flex-col justify-between h-full">
      
      {/* Cabeçalho */}
      <div className="space-y-3 pb-3 border-b border-border/40">
        <div className="flex justify-between items-center gap-2">
          <div className="space-y-0.5">
            <h3 className="font-extrabold text-foreground text-sm flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-emerald-500" />
              Últimas leituras da célula
            </h3>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground">Sincronização:</span>
              <span className={`flex items-center gap-1 font-bold ${['online', 'polling'].includes(realtimeStatus) ? 'text-emerald-600' : realtimeStatus === 'connecting' ? 'text-amber-600' : 'text-rose-600'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${['online', 'polling'].includes(realtimeStatus) ? 'bg-emerald-500 animate-pulse' : realtimeStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                {realtimeStatus === 'online'
                  ? 'Ativa (Realtime)'
                  : realtimeStatus === 'polling'
                    ? 'Automática (60–90 s)'
                    : realtimeStatus === 'connecting' ? 'Conectando' : 'Indisponível'}
              </span>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchReadings(true)}
            disabled={loading}
            className="h-8 px-2.5 rounded-lg border-border/60 text-xs gap-1.5 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading && 'animate-spin'}`} />
            Atualizar
          </Button>
        </div>

        {/* Linha de Filtros Compactos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg px-2 py-1.5 border border-border/30">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent w-full text-[11px] font-semibold text-foreground focus-visible:outline-none cursor-pointer"
            >
              <option value="24h">Últimas 24h</option>
              <option value="7days">Últimos 7 dias</option>
              <option value="month">Últimos 30 dias</option>
              <option value="all">Sem limites</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg px-2 py-1.5 border border-border/30">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <select
              value={shiftScope}
              onChange={(e) => setShiftScope(e.target.value)}
              className="bg-transparent w-full text-[11px] font-semibold text-foreground focus-visible:outline-none cursor-pointer"
            >
              <option value="all">Todos os turnos</option>
              <option value="current">{shift || 'Turno atual'}</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg px-2 py-1.5 border border-border/30">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <select
              value={machineScope}
              onChange={(e) => setMachineScope(e.target.value)}
              className="bg-transparent w-full text-[11px] font-semibold text-foreground focus-visible:outline-none cursor-pointer"
            >
              <option value="cell">Todas as máquinas</option>
              <option value="current" disabled={!workstationId}>Máquina selecionada</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg px-2 py-1.5 border border-border/30">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <select
              value={operatorScope}
              onChange={(e) => setOperatorScope(e.target.value)}
              className="bg-transparent w-full text-[11px] font-semibold text-foreground focus-visible:outline-none cursor-pointer"
            >
              <option value="cell">Toda a célula</option>
              <option value="mine" disabled={!operatorId}>Minhas coletas</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-secondary/30 rounded-lg px-2 py-1.5 border border-border/30">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent w-full text-[11px] font-semibold text-foreground focus-visible:outline-none cursor-pointer"
            >
              <option value="all">Todos Status</option>
              <option value="approved">Aprovadas</option>
              <option value="approved_via_replacement">↻ Via Reposição</option>
              <option value="rejected">Reprovadas</option>
              <option value="blocked">Bloqueadas</option>
              <option value="duplicated">Duplicadas</option>
              <option value="not_found">Não localizadas</option>
              <option value="error">Erros de sincronismo</option>
            </select>
          </div>
        </div>

        {/* Contador */}
        <p className="text-[11px] font-bold text-muted-foreground/80">
          Mostrando {Math.min(readings.length, totalCount)} de {totalCount} coletas encontradas
        </p>
      </div>

      {error && readings.length > 0 && (
        <p role="status" className="text-xs text-amber-600">{error} Exibindo a última lista confirmada.</p>
      )}

      {loading && readings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mb-2" />
          <p className="text-xs">Carregando leituras do banco...</p>
        </div>
      ) : error && readings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-rose-500 gap-2 border border-dashed border-rose-500/20 rounded-xl bg-rose-500/5">
          <AlertCircle className="w-8 h-8" />
          <p className="text-xs font-bold">{error}</p>
          <Button size="sm" variant="outline" onClick={() => fetchReadings(true)} className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10">Tentar novamente</Button>
        </div>
      ) : readings.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/40 rounded-xl text-muted-foreground flex flex-col items-center justify-center space-y-1">
          <Layers className="w-8 h-8 text-muted-foreground/30 mb-1" />
          <p className="font-bold text-foreground text-xs">Nenhuma coleta encontrada</p>
          <p className="text-[11px] text-muted-foreground max-w-[220px] mx-auto">
            Nenhuma coleta cadastrada para a célula no período selecionado.
          </p>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto max-h-[55vh] pr-1">
          {readings.map((read) => (
            <CollectionReadItem
              key={read.id || read.event_id}
              read={read}
              isSelected={selectedPiece && (selectedPiece.piece_uid === read.traceability_code || selectedPiece.id === read.piece_id)}
              onSelect={handleSelect}
              onReject={onRejectPiece}
              onCreateOccurrence={onCreateOccurrence}
              onOpenTraceability={onOpenTraceability}
              canReject={canReject}
            />
          ))}

          {readings.length < totalCount && (
            <Button
              onClick={handleLoadMore}
              variant="outline"
              className="w-full text-xs font-bold h-9 rounded-xl border-border/60 hover:bg-secondary/40 text-foreground mt-2"
            >
              Carregar mais coletas
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

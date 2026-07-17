import { useState, useEffect, useCallback, useRef } from 'react';
import { Layers, RefreshCw, AlertCircle, Filter, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getCollectionHistory,
  getCollectionHistoryCount,
  subscribeToCollectionHistory,
  unsubscribeFromCollectionHistory,
} from '@/lib/collectionService';
import CollectionReadItem from './CollectionReadItem';

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
  canReject = false
}) {
  const [readings, setReadings] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filtros Locais adicionais
  const [period, setPeriod] = useState('7days'); // 24h, 7days, month, all
  const [statusFilter, setStatusFilter] = useState('all'); // all, approved, rejected, blocked
  const [operatorScope, setOperatorScope] = useState('cell'); // cell, mine
  const [shiftScope, setShiftScope] = useState('all'); // all, current
  const [realtimeStatus, setRealtimeStatus] = useState(navigator.onLine ? 'connecting' : 'offline');
  const realtimeRefreshRef = useRef(null);

  const fetchReadings = useCallback(async (showLoading = true) => {
    if (!cellName) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { dateFrom, dateTo } = getDateRange(period);
      const activeStatus = statusFilter === 'all' ? null : statusFilter;

      console.log('CollectionRecentReadsPanel Fetching:', {
        cellName,
        workstationId: workstationId || null,
        operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
        shift: shiftScope === 'current' ? (shift || null) : null,
        status: activeStatus,
        limit,
        dateFrom,
        dateTo
      });

      // Executa a busca e a contagem em paralelo
      const [data, count] = await Promise.all([
        getCollectionHistory({
          cellName,
          workstationId: workstationId || null,
          operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
          shift: shiftScope === 'current' ? (shift || null) : null,
          status: activeStatus,
          limit,
          offset: 0,
          dateFrom,
          dateTo
        }),
        getCollectionHistoryCount({
          cellName,
          workstationId: workstationId || null,
          operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
          shift: shiftScope === 'current' ? (shift || null) : null,
          status: activeStatus,
          dateFrom,
          dateTo
        })
      ]);

      console.log('CollectionRecentReadsPanel Result:', { dataLength: data?.length, count });

      setReadings(data);
      setTotalCount(count);
    } catch (e) {
      console.error('CollectionRecentReadsPanel Error:', e);
      setError('Falha ao carregar o histórico de coletas do banco.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [cellName, workstationId, operatorId, operatorScope, shift, shiftScope, period, statusFilter, limit]);

  // Recarrega quando filtros, limit ou sinal mudar
  useEffect(() => {
    fetchReadings(true);
  }, [fetchReadings, refreshSignal]);

  // Inscrição Realtime
  useEffect(() => {
    if (!cellName) return;

    setRealtimeStatus(navigator.onLine ? 'connecting' : 'offline');
    const channel = subscribeToCollectionHistory({
      cellName,
      channelSuffix: 'panel',
      callback: () => {
        clearTimeout(realtimeRefreshRef.current);
        realtimeRefreshRef.current = setTimeout(() => fetchReadings(false), 350);
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('online');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('offline');
        else setRealtimeStatus('connecting');
      },
    });

    const onOffline = () => setRealtimeStatus('offline');
    const onOnline = () => setRealtimeStatus('connecting');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      clearTimeout(realtimeRefreshRef.current);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      unsubscribeFromCollectionHistory(channel);
    };
  }, [cellName, fetchReadings]);

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
      current_stage: read.current_stage_name,
      current_stage_name: read.current_stage_name,
      operator_name: read.operator_name,
      status: read.event_status,
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
              <span className="text-muted-foreground">Tempo real:</span>
              <span className={`flex items-center gap-1 font-bold ${realtimeStatus === 'online' ? 'text-emerald-600' : realtimeStatus === 'connecting' ? 'text-amber-600' : 'text-rose-600'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${realtimeStatus === 'online' ? 'bg-emerald-500 animate-pulse' : realtimeStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                {realtimeStatus === 'online' ? 'Ativo (Online)' : realtimeStatus === 'connecting' ? 'Conectando' : 'Indisponível'}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 text-xs">
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

      {loading && readings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mb-2" />
          <p className="text-xs">Carregando leituras do banco...</p>
        </div>
      ) : error ? (
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

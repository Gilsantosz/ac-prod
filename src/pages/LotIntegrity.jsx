import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { fetchGeneralLotTracking, calculateLotBalance } from '@/lib/lotTrackingService';
import {
  ClientLotHierarchy,
  GeneralLotSummaryCard,
  ProductionRouteFlow,
} from '@/components/lot-tracking/LotTrackingCards';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2, ShieldAlert, FileText, UserCheck,
  XOctagon, Loader2, Search, ChartNoAxesCombined, Factory, PackageCheck, ExternalLink
} from 'lucide-react';

const FALLBACK_STAGE_CATALOG = [
  { stage_code: 'cut', stage_label: 'Corte', stage_order: 1 },
  { stage_code: 'edge', stage_label: 'Borda', stage_order: 2 },
  { stage_code: 'drill', stage_label: 'Furação', stage_order: 3 },
  { stage_code: 'cnc', stage_label: 'Usinagem CNC', stage_order: 4 },
  { stage_code: 'joinery', stage_label: 'Marcenaria', stage_order: 5 },
  {
    stage_code: 'separation',
    stage_label: 'Separação',
    stage_order: 6,
    traceable_collection_required: false,
    manual_quantity_allowed: true,
  },
  {
    stage_code: 'packaging',
    stage_label: 'Embalagem',
    stage_order: 7,
    traceable_collection_required: false,
    manual_quantity_allowed: true,
  },
];

const LOT_DETAIL_QUERY_TIMEOUT_MS = 15_000;

async function runLotDetailQuery(request, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Tempo limite excedido ao carregar ${label}.`));
    }, LOT_DETAIL_QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function LotDetailLoadError({ title, error, onRetry }) {
  return (
    <Card className="border-rose-500/30 bg-rose-500/[0.04] p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-extrabold text-foreground">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {error?.message || 'Não foi possível consultar os dados deste lote.'}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="gap-2 rounded-xl">
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    </Card>
  );
}

class LotDetailErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <LotDetailLoadError
          title="Os detalhes deste lote não puderam ser exibidos"
          error={new Error('O problema ficou isolado neste painel; os outros lotes continuam disponíveis.')}
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }

    return this.props.children;
  }
}

export function buildEffectiveLotIntegrity({ clientLot, lotPieces = [], integrityData = null }) {
  if (!clientLot?.lot_id) return null;

  const totalPieces = Number(clientLot.total_pieces || lotPieces.length || integrityData?.total_pieces || 0);
  const stages = clientLot.stages?.length
    ? [...clientLot.stages].sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0))
    : FALLBACK_STAGE_CATALOG.map((stage) => ({
        ...stage,
        completed_pieces: 0,
        required_pieces: ['drill'].includes(stage.stage_code) ? 0 : totalPieces,
        progress_percent: ['drill'].includes(stage.stage_code) ? 100 : 0,
        remaining_pieces: ['drill'].includes(stage.stage_code) ? 0 : totalPieces,
      }));

  const activeStages = stages.filter((stage) =>
    Number(stage.required_pieces || 0) > 0
    && stage.traceable_collection_required !== false
  );

  let approvedPieces = 0;
  if (activeStages.length > 0) {
    approvedPieces = Math.max(0, Math.min(
      ...activeStages.map((stage) => Number(stage.completed_pieces || 0))
    ));
  } else if (lotPieces.length > 0) {
    approvedPieces = lotPieces.filter((piece) =>
      piece.status === 'completed'
      || piece.status === 'approved'
      || piece.status === 'shipped'
      || ['separation', 'packaging', 'shipping'].includes(piece.current_stage)
    ).length;
  }

  const blockedPieces = lotPieces.length > 0
    ? lotPieces.filter((piece) => piece.is_blocked || piece.status === 'blocked').length
    : Number(clientLot.blocked_pieces || 0);
  const reworkPieces = lotPieces.length > 0
    ? lotPieces.filter((piece) => piece.rework_status && piece.rework_status !== 'none').length
    : Number(clientLot.rework_pieces || 0);
  const replacementPieces = lotPieces.length > 0
    ? lotPieces.filter((piece) => piece.replacement_status && piece.replacement_status !== 'none').length
    : Number(clientLot.replacement_pieces || 0);
  const pendingPieces = Math.max(
    0,
    totalPieces - approvedPieces - blockedPieces - reworkPieces - replacementPieces
  );

  const sumRequired = activeStages.reduce(
    (total, stage) => total + Number(stage.required_pieces || 0),
    0
  );
  const sumCompleted = activeStages.reduce(
    (total, stage) => total + Math.min(
      Number(stage.completed_pieces || 0),
      Number(stage.required_pieces || 0)
    ),
    0
  );
  const integrityPercent = sumRequired > 0
    ? Math.round((sumCompleted / sumRequired) * 100)
    : Math.round(Number(clientLot.progress_percent || integrityData?.integrity_percent || 0));

  const bottleneckStage = activeStages
    .map((stage) => ({
      ...stage,
      remaining: Number(
        stage.remaining_pieces
        ?? Math.max(0, Number(stage.required_pieces || 0) - Number(stage.completed_pieces || 0))
      ),
    }))
    .sort((a, b) => b.remaining - a.remaining)[0];

  return {
    total_pieces: totalPieces,
    approved_pieces: approvedPieces,
    pending_pieces: pendingPieces,
    blocked_pieces: blockedPieces,
    rework_pieces: reworkPieces,
    replacement_pieces: replacementPieces,
    integrity_percent: Math.min(100, Math.max(0, integrityPercent)),
    bottleneck: bottleneckStage?.remaining > 0
      ? `${bottleneckStage.stage_label} (${bottleneckStage.remaining} peças pendentes)`
      : 'Nenhum',
    can_close: totalPieces > 0
      && approvedPieces === totalPieces
      && blockedPieces === 0
      && reworkPieces === 0
      && replacementPieces === 0,
    stages,
  };
}

export function toggleExpandedLotIds(currentIds = [], lotId) {
  if (!lotId) return [...currentIds];
  return currentIds.includes(lotId)
    ? currentIds.filter((id) => id !== lotId)
    : [...currentIds, lotId];
}

function LotIntegrityPanelData({ lot, children }) {
  const lotId = lot.lot_id;
  const [activeTab, setActiveTab] = useState('integrity');
  const sharedQueryOptions = {
    enabled: Boolean(lotId),
    staleTime: 15_000,
    retry: 1,
    retryDelay: 750,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  };

  const integrityQuery = useQuery({
    queryKey: ['lotIntegrityData', lotId],
    queryFn: async () => {
      const { data, error } = await runLotDetailQuery(
        supabase.rpc('calcular_integridade_do_lote', { p_lot_id: lotId }),
        'a integridade'
      );
      if (error) throw error;
      return data;
    },
    ...sharedQueryOptions,
  });

  const piecesQuery = useQuery({
    queryKey: ['lotPiecesFull', lotId],
    queryFn: async () => {
      const { data, error } = await runLotDetailQuery(
        supabase
          .from('production_pieces')
          .select('id, piece_uid, status, current_stage, is_blocked, rework_status, replacement_status')
          .eq('lot_id', lotId)
          .neq('status', 'cancelled'),
        'as peças'
      );
      if (error) throw error;
      return data || [];
    },
    ...sharedQueryOptions,
  });

  const problematicQuery = useQuery({
    queryKey: ['problematicPieces', lotId],
    queryFn: async () => {
      const { data, error } = await runLotDetailQuery(
        supabase
          .from('production_pieces')
          .select('*')
          .eq('lot_id', lotId)
          .or('is_blocked.eq.true,status.eq.rejected,status.eq.rework_pending,status.eq.rework_in_progress,status.eq.replacement_in_production')
          .neq('status', 'cancelled')
          .neq('status', 'replaced'),
        'as peças com anomalias'
      );
      if (error) throw error;
      return data || [];
    },
    ...sharedQueryOptions,
    enabled: Boolean(lotId) && activeTab === 'integrity',
  });

  const outOfFlowQuery = useQuery({
    queryKey: ['outOfFlowReadings', lotId],
    queryFn: async () => {
      const { data, error } = await runLotDetailQuery(
        supabase
          .from('production_events')
          .select(`
            id,
            traceability_code,
            event_type,
            from_stage,
            to_stage,
            cell_name,
            event_status,
            notes,
            created_at,
            piece_id,
            operators (name)
          `)
          .eq('event_type', 'block')
          .eq('lot_id', lotId)
          .order('created_at', { ascending: false })
          .limit(50),
        'as peças fora de fluxo'
      );
      if (error) throw error;
      return data || [];
    },
    ...sharedQueryOptions,
    enabled: Boolean(lotId) && activeTab === 'out-of-flow',
  });

  const logsQuery = useQuery({
    queryKey: ['integrityAuditLogs', lotId],
    queryFn: async () => {
      const { data, error } = await runLotDetailQuery(
        supabase
          .from('production_collection_events')
          .select('*')
          .eq('lot_id', lotId)
          .order('processed_at', { ascending: false })
          .limit(100),
        'os logs de auditoria'
      );
      if (error) throw error;
      return data || [];
    },
    ...sharedQueryOptions,
    enabled: Boolean(lotId) && activeTab === 'logs',
  });

  const effectiveIntegrity = useMemo(() => buildEffectiveLotIntegrity({
    clientLot: lot,
    lotPieces: piecesQuery.data || [],
    integrityData: integrityQuery.data || null,
  }), [integrityQuery.data, lot, piecesQuery.data]);

  return children({
    activeTab,
    setActiveTab,
    effectiveIntegrity,
    loadingIntegrity: integrityQuery.isLoading || piecesQuery.isLoading,
    integrityError: integrityQuery.error || piecesQuery.error,
    retryIntegrity: () => Promise.all([integrityQuery.refetch(), piecesQuery.refetch()]),
    problematicPieces: problematicQuery.data || [],
    loadingPieces: problematicQuery.isLoading,
    problematicError: problematicQuery.error,
    retryProblematic: problematicQuery.refetch,
    outOfFlowReadings: outOfFlowQuery.data || [],
    loadingOutOfFlow: outOfFlowQuery.isLoading,
    outOfFlowError: outOfFlowQuery.error,
    refetchOutOfFlow: outOfFlowQuery.refetch,
    integrityLogs: logsQuery.data || [],
    loadingLogs: logsQuery.isLoading,
    logsError: logsQuery.error,
    refetchLogs: logsQuery.refetch,
  });
}

export default function LotIntegrity() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [expandedLotIds, setExpandedLotIds] = useState([]);
  const [focusedLotId, setFocusedLotId] = useState('');
  const appliedClientLotParamRef = useRef('');
  const [generalLotSearch, setGeneralLotSearch] = useState('');

  // Filtros dos lotes de clientes
  const [clientLotSearch, setClientLotSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // all, started, not_started, completed
  const [filterCell, setFilterCell] = useState('all');
  const [filterBalance, setFilterBalance] = useState('all'); // all, balanced, unbalanced

  // Resetar filtros ao trocar o lote geral
  useEffect(() => {
    setClientLotSearch('');
    setFilterStatus('all');
    setFilterCell('all');
    setFilterBalance('all');
    appliedClientLotParamRef.current = '';
    setExpandedLotIds([]);
    setFocusedLotId('');
  }, [selectedBatchId]);

  // Liberação Especial Modal State
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [selectedPieceForRelease, setSelectedPieceForRelease] = useState(null);
  const [releaseForm, setReleaseForm] = useState({
    reason: 'Etapa executada manualmente offline',
    justification: '',
    impact: 'Nenhum impacto na montagem'
  });

  // O primeiro nível é sempre o lote geral importado pelo PCP.
  const { data: generalTracking, isLoading: loadingGeneralLots } = useQuery({
    queryKey: ['general-lot-tracking', 'overview'],
    queryFn: () => fetchGeneralLotTracking({ limit: 50 }),
    refetchInterval: 60_000,
  });

  const generalLots = generalTracking?.general_lots || [];

  useEffect(() => {
    const requestedGeneralLot = String(searchParams.get('generalLot') || '').trim().toUpperCase();
    if (!selectedBatchId && requestedGeneralLot) {
      const requested = generalLots.find((lot) =>
        String(lot.general_lot_code || '').trim().toUpperCase() === requestedGeneralLot
      );
      if (requested) {
        setSelectedBatchId(requested.batch_id);
        return;
      }
    }
    if (!selectedBatchId && generalLots.length === 1) {
      setSelectedBatchId(generalLots[0].batch_id);
    }
  }, [generalLots, searchParams, selectedBatchId]);

  const { data: selectedTracking, isLoading: loadingSelectedBatch } = useQuery({
    queryKey: ['general-lot-tracking', 'batch', selectedBatchId],
    queryFn: () => fetchGeneralLotTracking({ batchId: selectedBatchId, limit: 1 }),
    enabled: Boolean(selectedBatchId),
    refetchInterval: 30_000,
  });

  const selectedGeneralLot = selectedTracking?.general_lots?.[0]
    || generalLots.find((lot) => lot.batch_id === selectedBatchId)
    || null;

  const originalClientLots = useMemo(() => {
    return selectedGeneralLot?.client_lots || [];
  }, [selectedGeneralLot]);

  useEffect(() => {
    const requestedClientLot = String(searchParams.get('clientLot') || '').trim().toUpperCase();
    if (!requestedClientLot) {
      appliedClientLotParamRef.current = '';
      return;
    }
    if (!originalClientLots.length) return;

    const requestKey = `${selectedBatchId}:${requestedClientLot}`;
    if (appliedClientLotParamRef.current === requestKey) return;

    const requested = originalClientLots.find((lot) =>
      String(lot.lot_code || '').trim().toUpperCase() === requestedClientLot
    );
    if (requested) {
      appliedClientLotParamRef.current = requestKey;
      setExpandedLotIds((current) =>
        current.includes(requested.lot_id) ? current : [...current, requested.lot_id]
      );
      setFocusedLotId(requested.lot_id);
    }
  }, [originalClientLots, searchParams, selectedBatchId]);

  const filteredClientLots = useMemo(() => {
    let lots = originalClientLots;

    // 1. Busca por texto (Código ou Cliente)
    if (clientLotSearch.trim()) {
      const term = clientLotSearch.trim().toLocaleLowerCase('pt-BR');
      lots = lots.filter(lot => 
        String(lot.lot_code || '').toLocaleLowerCase('pt-BR').includes(term) ||
        String(lot.customer_name || '').toLocaleLowerCase('pt-BR').includes(term)
      );
    }

    // 2. Filtro de Status / Andamento
    if (filterStatus === 'started') {
      lots = lots.filter(lot => (lot.progress_percent || 0) > 0 && (lot.progress_percent || 0) < 100);
    } else if (filterStatus === 'not_started') {
      lots = lots.filter(lot => (lot.progress_percent || 0) === 0);
    } else if (filterStatus === 'completed') {
      lots = lots.filter(lot => (lot.progress_percent || 0) === 100);
    }

    // 3. Filtro de Célula Concluída
    if (filterCell !== 'all') {
      lots = lots.filter(lot => {
        const stage = lot.stages?.find(s => s.stage_code === filterCell);
        return stage && (stage.progress_percent || 0) === 100;
      });
    }

    // 4. Filtro de Equilíbrio
    if (filterBalance !== 'all') {
      lots = lots.filter(lot => {
        const score = calculateLotBalance(lot);
        if (filterBalance === 'balanced') {
          return score >= 75;
        } else if (filterBalance === 'unbalanced') {
          return score < 75;
        }
        return true;
      });
    }

    return lots;
  }, [originalClientLots, clientLotSearch, filterStatus, filterCell, filterBalance]);

  const filteredGeneralLots = useMemo(() => {
    const term = generalLotSearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return generalLots;
    return generalLots.filter((lot) => [lot.general_lot_code, lot.file_name]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(term)));
  }, [generalLots, generalLotSearch]);

  // Rolagem suave até o lote do cliente clicado
  useEffect(() => {
    if (!focusedLotId) return undefined;

    const timeoutId = window.setTimeout(() => {
      const el = document.getElementById(`client-lot-detail-${focusedLotId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [focusedLotId]);

  const handleToggleClientLot = (lot) => {
    const lotId = lot?.lot_id;
    if (!lotId) return;

    const wasExpanded = expandedLotIds.includes(lotId);
    const nextExpandedIds = toggleExpandedLotIds(expandedLotIds, lotId);
    setExpandedLotIds(nextExpandedIds);

    const next = new URLSearchParams(searchParams);
    if (selectedGeneralLot?.general_lot_code) {
      next.set('generalLot', selectedGeneralLot.general_lot_code);
    }

    if (wasExpanded) {
      setFocusedLotId((current) => (
        current === lotId
          ? nextExpandedIds[nextExpandedIds.length - 1] || ''
          : current
      ));
      if (
        String(next.get('clientLot') || '').trim().toUpperCase()
        === String(lot.lot_code || '').trim().toUpperCase()
      ) {
        next.delete('clientLot');
      }
      appliedClientLotParamRef.current = '';
    } else {
      setFocusedLotId(lotId);
      const clientLotCode = String(lot.lot_code || '').trim().toUpperCase();
      if (clientLotCode) {
        next.set('clientLot', clientLotCode);
        appliedClientLotParamRef.current = `${selectedBatchId}:${clientLotCode}`;
      }
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  };

  // Mutation - Encerramento de Lote
  const closeLotMutation = useMutation({
    mutationFn: async (lotId) => {
      const { data, error } = await supabase
        .from('production_lots')
        .update({ status: 'closed', current_status: 'completed', updated_at: new Date() })
        .eq('id', lotId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, lotId) => {
      toast.success('Lote encerrado com sucesso!');
      appliedClientLotParamRef.current = '';
      const remainingExpandedIds = expandedLotIds.filter((id) => id !== lotId);
      setExpandedLotIds(remainingExpandedIds);
      setFocusedLotId((focused) => (
        focused === lotId
          ? remainingExpandedIds[remainingExpandedIds.length - 1] || ''
          : focused
      ));
      const next = new URLSearchParams(searchParams);
      next.delete('clientLot');
      setSearchParams(next, { replace: true });
      qc.invalidateQueries({ queryKey: ['general-lot-tracking'] });
      qc.invalidateQueries({ queryKey: ['lot-tracking-dashboard'] });
    },
    onError: (err) => {
      toast.error(err.message || 'Falha ao encerrar o lote.');
    }
  });

  // Mutation - Liberação Especial
  const specialReleaseMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('authorize_special_release', {
        p_piece_id: payload.pieceId,
        p_stage: payload.stage,
        p_reason: payload.reason,
        p_justification: payload.justification,
        p_impact: payload.impact
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, payload) => {
      const lotId = payload.lotId;
      toast.success('Liberação Especial autorizada com sucesso!');
      setReleaseModalOpen(false);
      qc.invalidateQueries({ queryKey: ['lotIntegrityData', lotId] });
      qc.invalidateQueries({ queryKey: ['lotPiecesFull', lotId] });
      qc.invalidateQueries({ queryKey: ['problematicPieces', lotId] });
      qc.invalidateQueries({ queryKey: ['outOfFlowReadings', lotId] });
      qc.invalidateQueries({ queryKey: ['integrityAuditLogs', lotId] });
      qc.invalidateQueries({ queryKey: ['general-lot-tracking'] });
      qc.invalidateQueries({ queryKey: ['lot-tracking-dashboard'] });
    },
    onError: (err) => {
      toast.error(err.message || 'Falha ao autorizar liberação especial.');
    }
  });

  const handleOpenReleaseModal = (piece, targetStage, lotId) => {
    setSelectedPieceForRelease({ piece, targetStage, lotId });
    setReleaseForm({
      reason: 'Etapa executada manualmente offline',
      justification: '',
      impact: 'Nenhum impacto na montagem'
    });
    setReleaseModalOpen(true);
  };

  const handleReleaseSubmit = (e) => {
    e.preventDefault();
    if (!selectedPieceForRelease) return;
    specialReleaseMutation.mutate({
      pieceId: selectedPieceForRelease.piece.piece_id || selectedPieceForRelease.piece.id,
      lotId: selectedPieceForRelease.lotId,
      stage: selectedPieceForRelease.targetStage,
      reason: releaseForm.reason,
      justification: releaseForm.justification,
      impact: releaseForm.impact
    });
  };

  const handleRefreshAll = () => {
    qc.invalidateQueries({ queryKey: ['general-lot-tracking'] });
    qc.invalidateQueries({ queryKey: ['lot-tracking-dashboard'] });
    expandedLotIds.forEach((lotId) => {
      qc.invalidateQueries({ queryKey: ['lotIntegrityData', lotId] });
      qc.invalidateQueries({ queryKey: ['lotPiecesFull', lotId] });
      qc.invalidateQueries({ queryKey: ['problematicPieces', lotId] });
      qc.invalidateQueries({ queryKey: ['outOfFlowReadings', lotId] });
      qc.invalidateQueries({ queryKey: ['integrityAuditLogs', lotId] });
    });
    toast.success('Dados atualizados!');
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <PageHeader
          title="Painel de Integridade de Lote"
          subtitle="Rastreabilidade hierárquica do lote geral, seus lotes de clientes e todas as etapas até a separação."
          icon={ShieldCheck}
        />
        <Button asChild variant="outline" className="rounded-xl gap-2 border-border/60 shrink-0">
          <Link to="/acompanhamento-lotes">
            <ChartNoAxesCombined className="w-4 h-4" /> Abrir dashboard de acompanhamento
          </Link>
        </Button>
      </div>

      <Card className="p-5 border-border/60 shadow-sm space-y-4 bg-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">1</span>
              <h2 className="text-sm font-extrabold text-foreground">Escolha primeiro o lote geral carregado pelo PCP</h2>
            </div>
            <p className="mt-1 ml-9 text-xs text-muted-foreground">Exemplo: 15587. Os lotes de clientes aparecerão somente dentro dele.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={generalLotSearch}
              onChange={(event) => setGeneralLotSearch(event.target.value)}
              placeholder="Buscar lote geral..."
              className="pl-9 rounded-xl"
            />
          </div>
        </div>

        {loadingGeneralLots ? (
          <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : filteredGeneralLots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
            Nenhum lote geral ativo foi encontrado.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGeneralLots.map((lot) => (
              <GeneralLotSummaryCard
                key={lot.batch_id}
                lot={lot}
                selected={lot.batch_id === selectedBatchId}
                onSelect={(nextLot) => {
                  appliedClientLotParamRef.current = '';
                  setSelectedBatchId(nextLot.batch_id);
                  setExpandedLotIds([]);
                  setFocusedLotId('');
                  const next = new URLSearchParams(searchParams);
                  next.set('generalLot', nextLot.general_lot_code);
                  next.delete('clientLot');
                  setSearchParams(next, { replace: true });
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {selectedBatchId && (
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 text-xs font-black text-violet-700">2</span>
                <h2 className="text-sm font-extrabold text-foreground">Lotes de clientes do lote geral {selectedGeneralLot?.general_lot_code}</h2>
              </div>
              <p className="mt-1 ml-9 text-xs text-muted-foreground">Clientes com o mesmo nome permanecem juntos e seus lotes continuam rastreados separadamente.</p>
            </div>
            <Button onClick={handleRefreshAll} variant="outline" size="sm" className="h-9 rounded-xl gap-2 font-medium shrink-0 border-border/60">
              <RefreshCw className="w-4 h-4" /> Atualizar em tempo real
            </Button>
          </div>

          <ProductionRouteFlow stages={selectedGeneralLot?.stages || []} />

          {/* BARRA DE FILTROS DE LOTES DE CLIENTES */}
          <Card className="p-4 border-border/60 shadow-sm bg-card/60 backdrop-blur-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {/* Busca */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Buscar Cliente ou Lote</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={clientLotSearch}
                  onChange={(e) => setClientLotSearch(e.target.value)}
                  placeholder="Ex: Alexandre, 143345..."
                  className="pl-9 rounded-xl h-9 text-xs"
                />
              </div>
            </div>

            {/* Status / Andamento */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Andamento / Status</Label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="all">Todos os andamentos</option>
                <option value="started">Lotes Iniciados (Em andamento)</option>
                <option value="not_started">Lotes Não Iniciados (0%)</option>
                <option value="completed">Lotes Concluídos (100%)</option>
              </select>
            </div>

            {/* Células Concluídas */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Célula Concluída</Label>
              <select
                value={filterCell}
                onChange={(e) => setFilterCell(e.target.value)}
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="all">Todas as células</option>
                <option value="cut">Corte Concluído (100%)</option>
                <option value="edge">Borda Concluída (100%)</option>
                <option value="drill">Furação Concluída (100%)</option>
                <option value="cnc">Usinagem CNC Concluída (100%)</option>
                <option value="joinery">Marcenaria Concluída (100%)</option>
                <option value="separation">Separação Concluída (100%)</option>
                <option value="packaging">Embalagem Concluída (100%)</option>
              </select>
            </div>

            {/* Equilíbrio de Etapas */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Equilíbrio de Etapas</Label>
              <select
                value={filterBalance}
                onChange={(e) => setFilterBalance(e.target.value)}
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="all">Todos os níveis de equilíbrio</option>
                <option value="balanced">{"Mais Equilibrados (Var. < 25%)"}</option>
                <option value="unbalanced">{"Menos Equilibrados (Var. >= 25%)"}</option>
              </select>
            </div>
          </Card>

          {loadingSelectedBatch ? (
            <Card className="flex justify-center py-12 border-border/60"><Loader2 className="w-7 h-7 animate-spin text-primary" /></Card>
          ) : originalClientLots.length > 0 && filteredClientLots.length === 0 ? (
            <Card className="p-8 border-dashed text-center text-sm text-muted-foreground">
              Nenhum lote de cliente corresponde aos filtros selecionados. Experimente limpar ou ajustar os filtros.
            </Card>
          ) : (
            <ClientLotHierarchy
              clientLots={filteredClientLots}
              selectedLotIds={expandedLotIds}
              onSelect={(lot) => {
                handleToggleClientLot(lot);
              }}
              renderDetailPanel={(lot) => (
                <LotDetailErrorBoundary lotId={lot.lot_id}>
                  <LotIntegrityPanelData lot={lot}>
                  {({
                    activeTab,
                    setActiveTab,
                    effectiveIntegrity,
                    loadingIntegrity,
                    integrityError,
                    retryIntegrity,
                    problematicPieces,
                    loadingPieces,
                    problematicError,
                    retryProblematic,
                    outOfFlowReadings,
                    loadingOutOfFlow,
                    outOfFlowError,
                    refetchOutOfFlow,
                    integrityLogs,
                    loadingLogs,
                    logsError,
                    refetchLogs,
                  }) => (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                  <TabsList className="bg-secondary/40 p-1 rounded-xl h-11 border border-border/20">
                    <TabsTrigger value="integrity" className="rounded-lg text-xs font-bold px-4 py-2">Integridade do Lote</TabsTrigger>
                    <TabsTrigger value="out-of-flow" className="rounded-lg text-xs font-bold px-4 py-2">Peças Fora de Fluxo</TabsTrigger>
                    <TabsTrigger value="logs" className="rounded-lg text-xs font-bold px-4 py-2">Auditoria de Logs</TabsTrigger>
                  </TabsList>

                  {/* ABA 1: INTEGRIDADE DO LOTE */}
                  <TabsContent value="integrity" className="space-y-6 focus-visible:outline-none">
                    {integrityError ? (
                      <LotDetailLoadError
                        title="Falha ao carregar a integridade deste lote"
                        error={integrityError}
                        onRetry={retryIntegrity}
                      />
                    ) : loadingIntegrity && !effectiveIntegrity ? (
                      <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                    ) : (
                      effectiveIntegrity && (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            
                            {/* Gauge de Integridade */}
                            <Card className="lg:col-span-1 p-6 flex flex-col items-center justify-center text-center space-y-6 bg-card border-border/60">
                              <h4 className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Integridade do Lote</h4>
                              
                              <div className="relative w-40 h-40 flex items-center justify-center">
                                {/* Círculo de fundo */}
                                <svg className="w-full h-full transform -rotate-90">
                                  <circle cx="80" cy="80" r="70" className="stroke-secondary" strokeWidth="8" fill="transparent" />
                                  <circle 
                                    cx="80" 
                                    cy="80" 
                                    r="70" 
                                    className={effectiveIntegrity.integrity_percent === 100 ? "stroke-emerald-500" : "stroke-amber-500"} 
                                    strokeWidth="8" 
                                    fill="transparent" 
                                    strokeDasharray={440} 
                                    strokeDashoffset={440 - (440 * (effectiveIntegrity.integrity_percent || 0)) / 100}
                                    strokeLinecap="round"
                                  />
                                </svg>
                                <div className="absolute text-center">
                                  <p className="text-3xl font-extrabold text-foreground">{effectiveIntegrity.integrity_percent}%</p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">De Integridade</p>
                                </div>
                              </div>

                              <div className="w-full text-center space-y-2">
                                {effectiveIntegrity.can_close ? (
                                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl flex items-center justify-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Lote liberado para fechamento</span>
                                  </div>
                                ) : (
                                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl flex items-center justify-center gap-2">
                                    <AlertTriangle className="w-5 h-5 shrink-0" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Lote não pode ser fechado</span>
                                  </div>
                                )}
                                <p className="text-[11px] text-muted-foreground">O fechamento exige 100% de peças aprovadas e nenhuma reposição/retrabalho aberto.</p>
                              </div>

                              {effectiveIntegrity.can_close ? (
                                <Button 
                                  onClick={() => {
                                    if (confirm('Deseja realmente encerrar este lote de produção?')) {
                                      closeLotMutation.mutate(lot.lot_id);
                                    }
                                  }}
                                  disabled={closeLotMutation.isPending}
                                  className="w-full bg-emerald-500 hover:bg-emerald-600 font-bold rounded-xl"
                                >
                                  {closeLotMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                                  Encerrar Lote Produtivo
                                </Button>
                              ) : (
                                <Button disabled variant="outline" className="w-full rounded-xl opacity-60">
                                  Aguardando Resoluções
                                </Button>
                              )}
                            </Card>

                            {/* Estatísticas e Gargalo */}
                            <div className="lg:col-span-2 space-y-6">
                              {/* Contadores */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-muted-foreground font-bold uppercase block">Peças Totais</span>
                                  <p className="text-3xl font-extrabold text-foreground mt-1">{effectiveIntegrity.total_pieces}</p>
                                </div>
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-emerald-600 font-bold uppercase block">Aprovadas</span>
                                  <p className="text-3xl font-extrabold text-emerald-600 mt-1">{effectiveIntegrity.approved_pieces}</p>
                                </div>
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-amber-600 font-bold uppercase block">Pendentes de Etapa</span>
                                  <p className="text-3xl font-extrabold text-amber-600 mt-1">{effectiveIntegrity.pending_pieces}</p>
                                </div>
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-rose-600 font-bold uppercase block">Bloqueadas</span>
                                  <p className="text-3xl font-extrabold text-rose-600 mt-1">{effectiveIntegrity.blocked_pieces}</p>
                                </div>
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-purple-600 font-bold uppercase block">Em Retrabalho</span>
                                  <p className="text-3xl font-extrabold text-purple-600 mt-1">{effectiveIntegrity.rework_pieces}</p>
                                </div>
                                <div className="bg-card border border-border/60 rounded-2xl p-4">
                                  <span className="text-[10px] text-sky-600 font-bold uppercase block">Em Reposição</span>
                                  <p className="text-3xl font-extrabold text-sky-600 mt-1">{effectiveIntegrity.replacement_pieces}</p>
                                </div>
                              </div>

                              {/* Gargalo */}
                              <Card 
                                className="p-4 border-border/60 bg-secondary/15 flex items-center justify-between cursor-pointer hover:border-amber-500/40 hover:bg-secondary/25 transition-all group"
                                onClick={() => navigate('/alertas-mes')}
                                title="Ver todos os alertas na Central MES"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                                    <AlertTriangle className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted-foreground font-semibold">Gargalo Crítico do Lote</p>
                                    <p className="font-extrabold text-foreground text-sm mt-0.5">{effectiveIntegrity.bottleneck || 'Nenhum'}</p>
                                  </div>
                                </div>
                                <Badge 
                                  variant="outline" 
                                  className="border-amber-500/30 text-amber-600 bg-amber-500/10 group-hover:bg-amber-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <span>Alerta de Fluxo</span>
                                  <ExternalLink className="w-3 h-3 ml-0.5" />
                                </Badge>
                              </Card>
                            </div>
                            
                          </div>

                          {/* DETALHAMENTO DE CADA ESTAÇÃO E TOTAL GERAL PARA FECHAMENTO */}
                          <Card className="p-5 border-border/60 bg-card space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <h5 className="font-extrabold text-sm text-foreground flex items-center gap-2">
                                  <Factory className="w-4 h-4 text-primary" />
                                  Detalhamento por Estação Produtiva
                                </h5>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Contagem por etapa da rota, distinguindo coleta física de volume manual sem rastreabilidade
                                </p>
                              </div>
                              <Badge variant="outline" className="w-fit text-[10px] font-bold border-primary/20 text-primary bg-primary/5">
                                Coletas Obrigatórias: {effectiveIntegrity.stages.filter(s => (s.required_pieces || 0) > 0 && s.traceable_collection_required !== false).length}
                              </Badge>
                            </div>

                            <ProductionRouteFlow stages={effectiveIntegrity.stages} />

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-3">
                              {effectiveIntegrity.stages.map((stg) => {
                                const completed = Number(stg.completed_pieces || 0);
                                const required = Number(stg.required_pieces || 0);
                                const hasOrder = required > 0;
                                const isComplete = hasOrder && completed >= required;
                                const toneByStage = {
                                  cut: 'bg-emerald-500',
                                  edge: 'bg-sky-500',
                                  drill: 'bg-cyan-500',
                                  cnc: 'bg-violet-500',
                                  joinery: 'bg-amber-500',
                                  separation: 'bg-orange-500',
                                  packaging: 'bg-fuchsia-500',
                                };
                                const remaining = Math.max(0, required - completed);
                                const percent = hasOrder ? Math.min(100, Math.round((completed / required) * 100)) : 0;

                                return (
                                  <div 
                                    key={stg.stage_code} 
                                    className={`rounded-xl border p-3.5 space-y-2 transition-all ${
                                      !hasOrder 
                                        ? 'border-border/30 bg-secondary/10 opacity-70' 
                                        : isComplete 
                                        ? 'border-emerald-500/30 bg-emerald-500/[0.02]' 
                                        : 'border-border/60 bg-background/80'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-foreground">{stg.stage_label}</span>
                                      <span className={`text-xs font-black ${!hasOrder ? 'text-muted-foreground' : isComplete ? 'text-emerald-600' : 'text-foreground'}`}>
                                        {hasOrder ? `${completed} / ${required}` : '0 / 0'}
                                      </span>
                                    </div>

                                    {stg.traceable_collection_required === false && (
                                      <div className="flex flex-wrap gap-1">
                                        <Badge variant="outline" className="text-[8px] border-blue-500/25 bg-blue-500/10 text-blue-700">
                                          Coleta opcional
                                        </Badge>
                                        {Number(stg.manual_quantity || 0) > 0 && (
                                          <Badge variant="outline" className="text-[8px] border-amber-500/25 bg-amber-500/10 text-amber-700">
                                            {Number(stg.manual_quantity).toLocaleString('pt-BR')} manual
                                          </Badge>
                                        )}
                                      </div>
                                    )}

                                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                                      {hasOrder ? (
                                        <div 
                                          className={`h-full rounded-full transition-all duration-500 ${toneByStage[stg.stage_code] || 'bg-primary'}`}
                                          style={{ width: `${percent}%` }} 
                                        />
                                      ) : (
                                        <div className="h-full bg-muted-foreground/15 rounded-full w-full" />
                                      )}
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                                      {hasOrder ? (
                                        <>
                                          <span>{percent}% concluído</span>
                                          <span className="font-semibold">{remaining > 0 ? `${remaining} pendentes` : 'Concluída ✓'}</span>
                                        </>
                                      ) : (
                                        <span className="font-semibold text-muted-foreground italic">Sem pedido</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="rounded-xl border border-border/60 bg-secondary/25 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                              <div className="space-y-1">
                                <p className="font-bold text-foreground flex items-center gap-1.5">
                                  <PackageCheck className="w-4 h-4 text-emerald-600" />
                                  Total Geral para Fechamento do Lote
                                </p>
                                <p className="text-muted-foreground">
                                  {effectiveIntegrity.approved_pieces} de {effectiveIntegrity.total_pieces} peças prontas/concluídas ({effectiveIntegrity.integrity_percent}%).
                                  {effectiveIntegrity.pending_pieces > 0 ? ` Faltam ${effectiveIntegrity.pending_pieces} peças para concluir o lote 100%.` : ' Lote 100% concluído!'}
                                </p>
                              </div>
                              <Badge 
                                variant="outline" 
                                className={`text-xs font-bold shrink-0 px-3 py-1 ${effectiveIntegrity.can_close ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10' : 'border-amber-500/30 text-amber-600 bg-amber-500/10'}`}
                              >
                                {effectiveIntegrity.can_close ? 'Lote Concluído ✓' : `Faltam ${effectiveIntegrity.pending_pieces} peças`}
                              </Badge>
                            </div>
                          </Card>

                          {/* Tabela de Peças Problemáticas */}
                          <Card className="p-5 border-border/60 space-y-4">
                            <h5 className="font-bold text-sm text-foreground flex items-center gap-2">
                              <ShieldAlert className="w-4 h-4 text-rose-500" />
                              Peças Pendentes ou com Anomalias ({problematicPieces.length})
                            </h5>

                            {problematicError ? (
                              <LotDetailLoadError
                                title="Falha ao carregar as peças com anomalias"
                                error={problematicError}
                                onRetry={retryProblematic}
                              />
                            ) : loadingPieces ? (
                              <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                            ) : problematicPieces.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic py-4 text-center">Nenhuma peça deste lote está bloqueada, em retrabalho ou reposição.</p>
                            ) : (
                              <div className="border border-border/40 rounded-xl overflow-hidden">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs">Peça</TableHead>
                                      <TableHead className="text-xs">Estação Atual</TableHead>
                                      <TableHead className="text-xs">Status da Peça</TableHead>
                                      <TableHead className="text-xs">Retrabalho/Reposição</TableHead>
                                      <TableHead className="text-xs text-right">Ação</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {problematicPieces.map((p) => (
                                      <TableRow key={p.id}>
                                        <TableCell className="font-mono text-xs font-bold">{p.traceability_code}</TableCell>
                                        <TableCell className="text-xs font-semibold capitalize">{p.current_stage}</TableCell>
                                        <TableCell className="text-xs">
                                          <Badge variant={p.is_blocked ? "destructive" : "secondary"} className="text-[10px] py-0">
                                            {p.status}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs font-medium">
                                          {p.rework_status !== 'none' && <Badge variant="outline" className="text-[10px] text-purple-600 bg-purple-500/5 border-purple-500/20">Retrabalho: {p.rework_status}</Badge>}
                                          {p.replacement_status !== 'none' && <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/5 border-amber-500/20">Reposição: {p.replacement_status}</Badge>}
                                          {p.rework_status === 'none' && p.replacement_status === 'none' && <span className="text-muted-foreground">-</span>}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <Button 
                                            size="sm" 
                                            variant="outline" 
                                            className="h-7 text-[10px] gap-1 border-border/60 hover:bg-secondary/40"
                                            onClick={() => handleOpenReleaseModal(p, p.current_stage, lot.lot_id)}
                                          >
                                            <UserCheck className="w-3.5 h-3.5" /> Liberação Especial
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </Card>
                        </div>
                      )
                    )}
                  </TabsContent>

                  {/* ABA 2: PEÇAS FORA DE FLUXO */}
                  <TabsContent value="out-of-flow" className="space-y-6 focus-visible:outline-none">
                    <Card className="p-6 border-border/60 space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                          <XOctagon className="w-5 h-5 text-rose-500" />
                          Histórico de Tentativas Irregulares de Bipe
                        </h4>
                        <Button onClick={() => refetchOutOfFlow()} variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      </div>

                      {outOfFlowError ? (
                        <LotDetailLoadError
                          title="Falha ao carregar as peças fora de fluxo"
                          error={outOfFlowError}
                          onRetry={refetchOutOfFlow}
                        />
                      ) : loadingOutOfFlow ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                      ) : outOfFlowReadings.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-8 text-center">Nenhum evento de quebra de fluxo registrado.</p>
                      ) : (
                        <div className="border border-border/40 rounded-xl overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Código da Peça</TableHead>
                                <TableHead className="text-xs">Posto</TableHead>
                                <TableHead className="text-xs">De (Estação)</TableHead>
                                <TableHead className="text-xs">Para (Tentado)</TableHead>
                                <TableHead className="text-xs">Operador</TableHead>
                                <TableHead className="text-xs">Data/Hora</TableHead>
                                <TableHead className="text-xs">Motivo do Bloqueio</TableHead>
                                <TableHead className="text-xs text-right">Ação Corretiva</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {outOfFlowReadings.map((evt) => (
                                <TableRow key={evt.id}>
                                  <TableCell className="font-mono text-xs font-bold">{evt.traceability_code}</TableCell>
                                  <TableCell className="text-xs font-semibold">{evt.cell_name}</TableCell>
                                  <TableCell className="text-xs capitalize">{evt.from_stage}</TableCell>
                                  <TableCell className="text-xs capitalize text-rose-500 font-bold">{evt.to_stage}</TableCell>
                                  <TableCell className="text-xs">{evt.operators?.name || 'Operador'}</TableCell>
                                  <TableCell className="text-xs">{new Date(evt.created_at).toLocaleString('pt-BR')}</TableCell>
                                  <TableCell className="text-xs text-rose-600 font-medium max-w-xs truncate" title={evt.notes}>
                                    {evt.notes}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      className="h-7 text-[10px] gap-1 border-border/60 hover:bg-secondary/40"
                                      onClick={() => handleOpenReleaseModal(
                                        { id: evt.piece_id, traceability_code: evt.traceability_code },
                                        evt.to_stage,
                                        lot.lot_id
                                      )}
                                    >
                                      <UserCheck className="w-3.5 h-3.5" /> Forçar Liberação
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </Card>
                  </TabsContent>

                  {/* ABA 3: LOGS DE AUDITORIA */}
                  <TabsContent value="logs" className="space-y-6 focus-visible:outline-none">
                    <Card className="p-6 border-border/60 space-y-4">
                      <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                        <FileText className="w-5 h-5 text-primary" />
                        Logs Completos do Motor de Rastreabilidade e Integridade
                      </h4>

                      {logsError ? (
                        <LotDetailLoadError
                          title="Falha ao carregar os logs deste lote"
                          error={logsError}
                          onRetry={refetchLogs}
                        />
                      ) : loadingLogs ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                      ) : integrityLogs.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-8 text-center">Nenhum evento de auditoria recente para este lote.</p>
                      ) : (
                        <div className="border border-border/40 rounded-xl overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Data/Hora</TableHead>
                                <TableHead className="text-xs">Peça</TableHead>
                                <TableHead className="text-xs">Estação / Célula</TableHead>
                                <TableHead className="text-xs">Operador</TableHead>
                                <TableHead className="text-xs">Ação</TableHead>
                                <TableHead className="text-xs">Resultado da Validação</TableHead>
                                <TableHead className="text-xs">Log de Detalhes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {integrityLogs.map((log) => {
                                const isError = log.result_status === 'blocked' || log.status === 'ignored';
                                const isWarning = log.result_status === 'duplicated';
                                return (
                                  <TableRow key={log.id}>
                                    <TableCell className="text-xs">{new Date(log.processed_at || log.created_at).toLocaleString('pt-BR')}</TableCell>
                                    <TableCell className="font-mono text-xs font-bold">{log.piece_code || log.raw_value}</TableCell>
                                    <TableCell className="text-xs font-semibold">{log.cell_name}</TableCell>
                                    <TableCell className="text-xs">{log.operator_name || 'Operador'}</TableCell>
                                    <TableCell className="text-xs capitalize">{log.reader_type}</TableCell>
                                    <TableCell className="text-xs">
                                      <Badge 
                                        variant={isError ? "destructive" : isWarning ? "outline" : "secondary"} 
                                        className={`text-[10px] py-0 ${isWarning ? 'border-amber-500/20 text-amber-600 bg-amber-500/5' : ''}`}
                                      >
                                        {log.result_status || log.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground max-w-sm truncate" title={log.error_message || 'OK'}>
                                      {log.error_message || 'Sucesso'}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </Card>
                  </TabsContent>
                </Tabs>
                  )}
                  </LotIntegrityPanelData>
                </LotDetailErrorBoundary>
              )}
            />
          )}
        </section>
      )}

      {/* DIALOG DE AUTORIZAÇÃO DE LIBERAÇÃO ESPECIAL */}
      <Dialog open={releaseModalOpen} onOpenChange={setReleaseModalOpen}>
        <DialogContent className="max-w-md rounded-2xl bg-card border border-border/80">
          <form onSubmit={handleReleaseSubmit}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary animate-pulse" />
                Liberação Especial de Fluxo
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Aprovação manual supervisionada da peça <strong className="font-mono text-foreground">{selectedPieceForRelease?.piece?.traceability_code}</strong> na etapa <strong className="capitalize text-foreground">{selectedPieceForRelease?.targetStage}</strong>. Esta ação anula bloqueios e audita o responsável.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="release-reason" className="text-xs font-semibold">Motivo</Label>
                <select
                  id="release-reason"
                  value={releaseForm.reason}
                  onChange={(e) => setReleaseForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
                >
                  <option value="Etapa executada manualmente offline">Etapa executada manualmente offline</option>
                  <option value="Peça liberada por autorização gerencial">Peça liberada por autorização gerencial</option>
                  <option value="Ajuste técnico de roteiro">Ajuste técnico de roteiro</option>
                  <option value="Necessidade de urgência operacional">Necessidade de urgência operacional</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="release-justification" className="text-xs font-semibold">Justificativa Detalhada</Label>
                <textarea
                  id="release-justification"
                  value={releaseForm.justification}
                  onChange={(e) => setReleaseForm(f => ({ ...f, justification: e.target.value }))}
                  required
                  placeholder="Informe detalhadamente por que esta peça está sendo autorizada a pular esta estação obrigatória..."
                  className="w-full min-h-20 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="release-impact" className="text-xs font-semibold">Impacto / Risco</Label>
                <Input
                  id="release-impact"
                  value={releaseForm.impact}
                  onChange={(e) => setReleaseForm(f => ({ ...f, impact: e.target.value }))}
                  placeholder="Ex: Nenhum risco para montagem"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReleaseModalOpen(false)} className="rounded-xl h-9 border-border/60 font-medium">
                Cancelar
              </Button>
              <Button type="submit" disabled={specialReleaseMutation.isPending} size="sm" className="rounded-xl h-9 bg-primary text-white font-bold">
                {specialReleaseMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Autorizar Liberação
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

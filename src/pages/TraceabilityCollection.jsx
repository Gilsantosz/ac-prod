import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, RadioTower, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import TraceabilityKpiCards from '@/components/traceability/TraceabilityKpiCards';
import LotProgressCard from '@/components/traceability/LotProgressCard';
import PieceRouteTimeline from '@/components/traceability/PieceRouteTimeline';
import LastReadingsList from '@/components/traceability/LastReadingsList';
import RejectionOccurrenceDialog from '@/components/traceability/RejectionOccurrenceDialog';
import RfidReadinessPanel from '@/components/traceability/RfidReadinessPanel';
import { useAuth } from '@/lib/AuthContext';
import { useCells } from '@/hooks/useCells';
import { base44 } from '@/lib/localDb';
import {
  fetchCollectionKpis,
  fetchRecentReadings,
  processProductionReading,
  registerTraceabilityRejection,
} from '@/lib/traceabilityService';

function currentShift() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return '1º Turno';
  if (hour >= 14 && hour < 22) return '2º Turno';
  return '3º Turno';
}

export default function TraceabilityCollection({ embedded = false }) {
  const { user } = useAuth();
  const { activeCells, isLoading: cellsLoading } = useCells();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('scanner');
  const [cellName, setCellName] = useState(() => {
    try { return user?.cell || localStorage.getItem('traceability-cell') || ''; }
    catch { return user?.cell || ''; }
  });
  const [shift, setShift] = useState(currentShift());
  const [feedback, setFeedback] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [rejectionOpen, setRejectionOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const processingRef = useRef(false);
  const operator = user?.name || user?.email || '';

  useEffect(() => {
    if (!cellName && user?.cell) setCellName(user.cell);
  }, [cellName, user?.cell]);

  useEffect(() => {
    if (!cellName) return;
    try { localStorage.setItem('traceability-cell', cellName); }
    catch { /* armazenamento indisponível */ }
  }, [cellName]);

  const { data: readings = [], isFetching: readingsLoading } = useQuery({
    queryKey: ['production-stage-readings'],
    queryFn: () => fetchRecentReadings(30),
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

  const handleRead = useCallback(async (payload) => {
    if (processingRef.current) {
      return { success: false, status: 'processing', message: 'Aguarde a leitura atual terminar.' };
    }
    if (!cellName) {
      const result = { success: false, status: 'invalid_context', message: 'Selecione a célula antes de processar a leitura.' };
      setFeedback(result);
      toast.warning(result.message);
      return result;
    }
    if (!operator) {
      const result = { success: false, status: 'invalid_context', message: 'Não foi possível identificar o operador conectado.' };
      setFeedback(result);
      toast.error(result.message);
      return result;
    }

    processingRef.current = true;
    setProcessing(true);
    try {
      const result = await processProductionReading({
        ...payload,
        cellName,
        shift,
        operator,
      });
      setFeedback(result);
      if (result?.success) {
        toast.success(result.message || 'Leitura aprovada');
        navigator.vibrate?.([70, 40, 70]);
      } else if (['wrong_step', 'wrong_cell', 'duplicated'].includes(result?.status)) {
        toast.warning(result.message || 'Leitura bloqueada');
      } else {
        toast.error(result?.message || 'Leitura não aprovada');
      }
      refreshData();
      return result;
    } catch (error) {
      const result = { success: false, status: 'error', message: error?.message || 'Falha ao processar leitura.' };
      setFeedback(result);
      toast.error(result.message);
      return result;
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [cellName, operator, refreshData, shift]);

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
        operator: user?.name || user?.email,
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

  const pageClass = embedded ? 'space-y-5' : 'p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto space-y-5 sm:space-y-6';

  const scanner = useMemo(() => (
    <TraceabilityScannerPanel
      mode={mode}
      onModeChange={setMode}
      onRead={handleRead}
      loading={processing}
      feedback={feedback}
      cellName={cellName}
      shift={shift}
      operator={operator}
    />
  ), [mode, handleRead, processing, feedback, cellName, shift, operator]);

  return (
    <div className={pageClass}>
      {!embedded && (
        <PageHeader title="Coleta por Código / RFID" subtitle="Baixa produtiva por lote, peça, etapa e célula." icon={ScanLine} />
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end bg-card border border-border rounded-md p-4">
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-cell" className="text-xs font-semibold text-muted-foreground">Célula da coleta</label>
          <select id="traceability-cell" value={cellName} onChange={(event) => setCellName(event.target.value)} disabled={processing || cellsLoading} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60" required>
            <option value="">{cellsLoading ? 'Carregando células...' : activeCells.length ? 'Selecione a célula' : 'Nenhuma célula ativa cadastrada'}</option>
            {activeCells.map((cell) => <option key={cell.id} value={cell.name}>{cell.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 flex-1">
          <label htmlFor="traceability-shift" className="text-xs font-semibold text-muted-foreground">Turno</label>
          <select id="traceability-shift" value={shift} onChange={(event) => setShift(event.target.value)} disabled={processing} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
            {['1º Turno', '2º Turno', '3º Turno'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 flex-1"><p className="text-xs font-semibold text-muted-foreground">Operador</p><div className="h-10 rounded-md border border-border bg-secondary/50 px-3 flex items-center text-sm font-medium truncate">{operator || 'Não identificado'}</div></div>
      </div>

      <TraceabilityKpiCards kpis={kpis} />
      {scanner}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <LotProgressCard lot={feedback?.lot} item={feedback?.item} tagValue={feedback?.reading?.tag_value} />
        <PieceRouteTimeline route={route} currentStep={feedback?.item?.current_step} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <RfidReadinessPanel />
        <Button variant="destructive" className="gap-2 shrink-0" disabled={!feedback?.item?.id} onClick={() => setRejectionOpen(true)}>
          <AlertOctagon /> Registrar Ocorrência / Reprovar Peça
        </Button>
      </div>

      <LastReadingsList readings={readings} loading={readingsLoading} />

      <div className="text-xs text-muted-foreground flex items-center gap-2"><RadioTower className="w-4 h-4" /> Câmeras exigem HTTPS em produção. Scanner físico e modo manual continuam disponíveis sem câmera.</div>

      <RejectionOccurrenceDialog open={rejectionOpen} onOpenChange={setRejectionOpen} context={feedback} onSubmit={handleReject} loading={rejecting} />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  Box,
  CheckCircle2,
  Clock3,
  Factory,
  Layers,
  LogOut,
  MapPin,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Route,
  ScanLine,
  Settings2,
  ShieldAlert,
  Truck,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useCollectionQueue } from '@/hooks/useCollectionQueue';
import {
  clearOperatorSession,
  detachOperatorSession,
  getDeviceId,
} from '@/lib/operatorSessionService';
import {
  formatStageName,
  getReplacementStationQueue,
  subscribeToReplacementCell,
  unsubscribeFromReplacementCell,
} from '@/lib/replacementService';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEvent,
} from '@/lib/collectionEventDispatcher';

const EMPTY_QUEUE = { available: [], on_way: [], completed: [], summary: {} };

function normalizeStage(value) {
  const key = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return ({
    corte: 'cut', cut: 'cut',
    borda: 'edge', bordo: 'edge', edge: 'edge',
    furacao: 'drill', drill: 'drill',
    usinagem: 'cnc', usinagem_cnc: 'cnc', cnc: 'cnc',
    marcenaria: 'joinery', joinery: 'joinery',
    separacao: 'separation', separation: 'separation',
    embalagem: 'packaging', packaging: 'packaging',
  })[key] || key;
}

function formatDuration(seconds) {
  const value = Math.max(Number(seconds) || 0, 0);
  if (value < 3600) return `${Math.max(Math.floor(value / 60), 1)} min`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

function formatMeasurement(value) {
  if (value == null || value === '') return '—';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString('pt-BR')} mm` : `${value} mm`;
}

function dimensionsLabel(dimensions = {}) {
  const length = dimensions.length ?? dimensions.comprimento;
  const width = dimensions.width ?? dimensions.largura;
  const height = dimensions.height ?? dimensions.altura;
  if ([length, width, height].every((value) => value == null || value === '')) return '—';
  const show = (value) => value == null || value === '' ? '—' : Number(value).toLocaleString('pt-BR');
  return `C ${show(length)} × L ${show(width)} × A ${show(height)} mm`;
}

function QueueCard({ item, informative = false, completed = false }) {
  const route = Array.isArray(item.route) ? item.route : [];
  const completedSteps = new Set((item.completed_steps || []).map(normalizeStage));
  const materialColor = [item.material, item.color].filter(Boolean).join(' · ') || '—';
  const statusLabel = completed ? 'Baixa concluída' : informative ? 'A caminho' : 'Disponível agora';
  const statusClass = completed
    ? 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300'
    : informative
      ? 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300'
      : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';

  return (
    <article className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="border-b border-border/50 bg-secondary/15 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-black text-foreground">{item.replacement_code || 'REP'}</span>
              <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>{statusLabel}</Badge>
              <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-bold capitalize">{item.priority || 'normal'}</Badge>
            </div>
            <p className="mt-1 break-all font-mono text-xs font-semibold text-muted-foreground">Etiqueta: {item.barcode || 'Sem código'}</p>
          </div>
          {item.open_seconds != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" /> {formatDuration(item.open_seconds)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4 md:p-5">
        <section className="grid gap-3 md:grid-cols-2">
          <IdentityPanel
            title="Peça original reprovada"
            code={item.original_piece?.code}
            name={item.original_piece?.name}
            tone="rose"
          />
          <IdentityPanel
            title="Peça substituta para produzir"
            code={item.replacement_piece?.code || item.barcode}
            name={item.replacement_piece?.name}
            tone="emerald"
          />
        </section>

        <section data-testid="replacement-station-technical-specs" className="grid gap-3 md:grid-cols-3">
          <TechnicalSpec
            icon={Box}
            label="Dimensões da peça"
            value={dimensionsLabel(item.dimensions)}
            description="Comprimento × largura × altura"
            emphasis
          />
          <TechnicalSpec
            icon={Layers}
            label="Material / cor"
            value={materialColor}
            description="Padrão que deve ser utilizado"
          />
          <TechnicalSpec
            icon={Factory}
            label="Espessura"
            value={formatMeasurement(item.thickness)}
            description="Conferir antes de iniciar a produção"
          />
        </section>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <InfoTile label="Lote geral" value={item.general_lot_code} mono />
          <InfoTile label="Lote cliente" value={item.client_lot_code} mono />
          <InfoTile label="Pedido" value={item.order_number} mono />
          <InfoTile label="Cliente" value={item.customer_name} />
          <InfoTile label="Ambiente" value={item.environment_name} />
          <InfoTile label="Descrição" value={item.description} />
        </section>

        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">
            <ShieldAlert className="h-3.5 w-3.5" /> Motivo da reposição
          </p>
          <p className="mt-1 break-words text-sm font-bold text-foreground">{item.rejection_reason || 'Motivo não informado'}</p>
        </section>

        <section className="space-y-3 rounded-2xl border border-border/60 bg-secondary/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-black text-foreground"><Route className="h-4 w-4 text-amber-500" /> Rota produtiva</p>
            <p className="text-[10px] font-semibold text-muted-foreground">Verde: concluída · Laranja: etapa deste posto</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {route.map((step, index) => {
              const code = normalizeStage(step);
              const isDone = completedSteps.has(code) || completed;
              const isCurrent = !completed && code === normalizeStage(item.current_step);
              const style = isDone
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : isCurrent
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300'
                  : 'border-border bg-background text-muted-foreground';
              return (
                <span key={`${step}-${index}`} className="contents">
                  {index > 0 && <span className="text-[10px] text-muted-foreground">➔</span>}
                  <span className={`rounded-xl border px-2.5 py-1.5 text-[10px] font-bold ${style}`}>
                    {isDone ? '✓' : isCurrent ? '●' : '○'} {formatStageName(step)}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Etapa atual</p>
              <p className="mt-0.5 text-sm font-black text-amber-700 dark:text-amber-300">{formatStageName(item.current_step || item.completed_stage || '—')}</p>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Próxima etapa</p>
              <p className="mt-0.5 text-sm font-black text-blue-700 dark:text-blue-300">{item.next_step ? formatStageName(item.next_step) : completed ? 'Rota finalizada' : 'Última etapa da rota'}</p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}

function IdentityPanel({ title, code, name, tone }) {
  const toneClass = tone === 'rose'
    ? 'border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-300'
    : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-300';
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <p className="text-[9px] font-bold uppercase tracking-wider">{title}</p>
      <p className="mt-1 break-all font-mono text-sm font-black text-foreground">{code || 'Código não informado'}</p>
      <p className="mt-1 break-words text-xs font-semibold text-muted-foreground">{name || 'Nome da peça não informado'}</p>
    </div>
  );
}

function TechnicalSpec({ icon: Icon, label, value, description, emphasis = false }) {
  return (
    <div className={`rounded-2xl border p-4 ${emphasis ? 'border-amber-500/30 bg-amber-500/8' : 'border-border/60 bg-background'}`}>
      <div className="flex items-center gap-2 text-muted-foreground"><Icon className={`h-4 w-4 ${emphasis ? 'text-amber-600' : 'text-primary'}`} /><p className="text-[10px] font-bold uppercase tracking-wider">{label}</p></div>
      <p className={`mt-2 break-words font-black text-foreground ${emphasis ? 'text-lg' : 'text-base'}`}>{value || '—'}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{description}</p>
    </div>
  );
}

function InfoTile({ label, value, mono = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-secondary/20 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words text-xs font-bold text-foreground ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function ContextSelector({ session, onConfirm, loading }) {
  const cells = session?.cells || [];
  const autoSubmittedRef = useRef(false);
  const [cellId, setCellId] = useState(cells.length === 1 ? cells[0].id : '');
  const machines = useMemo(
    () => (session?.machines || []).filter((machine) => machine.cell_id === cellId && machine.allows_replacement !== false),
    [session?.machines, cellId],
  );
  const [machineId, setMachineId] = useState('');

  useEffect(() => {
    setMachineId(machines.length === 1 ? machines[0].id : '');
  }, [machines]);

  useEffect(() => {
    if (cells.length !== 1 || machines.length > 1 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    onConfirm(cells[0].id, machines[0]?.id || null);
  }, [cells, machines, onConfirm]);

  return (
    <section className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-xl">
      <div className="border-b border-border/60 bg-amber-500/5 p-5 md:p-7">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600"><Settings2 className="h-6 w-6" /></div>
          <div>
            <h2 className="text-lg font-black">Identifique a célula e o posto</h2>
            <p className="mt-1 max-w-xl text-pretty text-sm text-muted-foreground">Escolha onde as peças substitutas serão produzidas e bipadas. A seleção vale somente para esta sessão operacional.</p>
          </div>
        </div>
      </div>
      <div className="grid border-b border-border/60 sm:grid-cols-3">
        <ContextDetail icon={ShieldAlert} title="Acesso validado" text="Colaborador liberado para reposição" />
        <ContextDetail icon={Factory} title={`${cells.length} célula(s)`} text="Somente vínculos ativos do cadastro" />
        <ContextDetail icon={Settings2} title={`${(session?.machines || []).filter((machine) => machine.allows_replacement !== false).length} posto(s)`} text="Máquinas habilitadas para baixa" />
      </div>
      <div className="p-5 md:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="replacement-cell">Célula autorizada</Label>
            <select id="replacement-cell" value={cellId} onChange={(event) => setCellId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">Selecione...</option>
              {cells.map((cell) => <option key={cell.id} value={cell.id}>{cell.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacement-machine">Máquina / posto</Label>
            <select id="replacement-machine" value={machineId} onChange={(event) => setMachineId(event.target.value)} disabled={!cellId || machines.length === 0} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60">
              <option value="">{machines.length ? 'Selecione...' : 'Sem máquina obrigatória'}</option>
              {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
            </select>
          </div>
        </div>
        <Button className="mt-6 h-11 w-full rounded-xl bg-amber-500 font-bold text-white hover:bg-amber-600" disabled={!cellId || loading || (machines.length > 0 && !machineId)} onClick={() => onConfirm(cellId, machineId || null)}>
          {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
          Iniciar posto de reposição
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">Todas as baixas serão vinculadas ao colaborador, célula, posto, dispositivo e horário desta sessão.</p>
      </div>
    </section>
  );
}

function ReplacementStation() {
  const navigate = useNavigate();
  const {
    session, token, operatorName, registration, shift, cells, machines,
    selectedCellId, selectedCellName, selectedMachineId, selectedMachineName,
    loading: sessionLoading, logout, setContext,
  } = useOperatorSession();
  const [queue, setQueue] = useState(EMPTY_QUEUE);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [realtimeStatus, setRealtimeStatus] = useState('CLOSED');
  const inputRef = useRef(null);
  const focusTimerRef = useRef(null);
  const scanTimerRef = useRef(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const audioContextRef = useRef(null);
  const cleanupRef = useRef({ flush: null, unsyncedCount: 0 });

  const processQueuedEvent = useCallback(async (event) => dispatchCollectionEvent(event), []);
  const { stats, flushing, enqueue, flush, processNow, retryQueueErrors } = useCollectionQueue(processQueuedEvent, {
    cellName: selectedCellName,
    machineId: selectedMachineId,
    eventKind: COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE,
  });
  const unsyncedCount = stats.pending + stats.processing + stats.error;

  useEffect(() => {
    cleanupRef.current = { flush, unsyncedCount };
  }, [flush, unsyncedCount]);

  const playFeedback = useCallback((success) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const context = audioContextRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = success ? 880 : 220;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.17);
    } catch { /* feedback sonoro é complementar */ }
  }, []);

  const loadQueue = useCallback(async ({ silent = false } = {}) => {
    if (!token || !selectedCellId) return;
    const requestId = ++requestRef.current;
    if (!silent) setLoadingQueue(true);
    try {
      const data = await getReplacementStationQueue(token);
      if (mountedRef.current && requestRef.current === requestId) setQueue(data);
    } catch (error) {
      if (mountedRef.current) toast.error(error.message || 'Falha ao carregar a fila do posto.');
    } finally {
      if (mountedRef.current && requestRef.current === requestId) setLoadingQueue(false);
    }
  }, [token, selectedCellId]);

  useEffect(() => {
    if (selectedCellId) loadQueue();
  }, [selectedCellId, selectedMachineId, loadQueue]);

  useEffect(() => {
    if (!selectedCellId) return undefined;
    const channel = subscribeToReplacementCell({
      cellId: selectedCellId,
      onStatus: setRealtimeStatus,
      onMessage: (message) => {
        loadQueue({ silent: true });
        const notification = message?.payload?.message;
        if (notification) {
          playFeedback(true);
          toast.info(notification);
        }
      },
    });
    return () => { unsubscribeFromReplacementCell(channel); };
  }, [selectedCellId, loadQueue, playFeedback]);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); flush(); };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flush]);

  useEffect(() => {
    if (!selectedCellId) return undefined;
    focusTimerRef.current = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(focusTimerRef.current);
  }, [selectedCellId, lastResult]);

  const submitScan = useCallback(async (rawBarcode) => {
    const code = String(rawBarcode || '').replace(/[\r\n]/g, '').trim();
    if (!code || processing || !selectedCellId) return;
    setProcessing(true);
    setBarcode('');
    const createdAtClient = new Date().toISOString();
    const clientEventId = crypto.randomUUID();
    try {
      await enqueue({
        event_kind: COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE,
        client_event_id: clientEventId,
        raw_value: code,
        session_token: token,
        device_id: getDeviceId(),
        created_at_client: createdAtClient,
        queued_offline: !navigator.onLine,
        cellName: selectedCellName,
        cell_id: selectedCellId,
        machineId: selectedMachineId,
        machineName: selectedMachineName,
        operator_name: operatorName,
        shift,
      }, { autoFlush: false });

      if (!navigator.onLine) {
        setLastResult({ success: false, result_status: 'offline_queued', message: 'Leitura salva, aguardando sincronização.', barcode: code });
        toast.info('Leitura salva, aguardando sincronização.');
        return;
      }

      const result = await processNow(clientEventId);
      if (!mountedRef.current) return;
      setLastResult({ ...result, barcode: code });
      playFeedback(true);
      toast.success(result.message || 'Baixa confirmada pelo servidor.');
      await loadQueue({ silent: true });
    } catch (error) {
      if (!mountedRef.current) return;
      const result = error.result || {
        success: false,
        result_status: 'error',
        reason_code: 'SYNC_PENDING',
        message: error.message || 'Falha ao sincronizar. O evento permanece na fila.',
      };
      setLastResult({ ...result, barcode: code });
      playFeedback(false);
      toast.error(result.message);
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  }, [
    enqueue, loadQueue, operatorName, playFeedback, processNow, processing,
    selectedCellId, selectedCellName, selectedMachineId, selectedMachineName,
    shift, token,
  ]);

  const handleBarcodeChange = (event) => {
    const value = event.target.value;
    setBarcode(value);
    window.clearTimeout(scanTimerRef.current);
    if (/\r|\n/.test(value)) submitScan(value);
    else if (value.trim().length >= 6) scanTimerRef.current = window.setTimeout(() => submitScan(value), 220);
  };

  useEffect(() => () => {
    mountedRef.current = false;
    requestRef.current += 1;
    window.clearTimeout(focusTimerRef.current);
    window.clearTimeout(scanTimerRef.current);
    const { flush: flushLatest, unsyncedCount: pendingLatest } = cleanupRef.current;
    if (navigator.onLine && pendingLatest > 0) flushLatest?.();
    if (pendingLatest === 0) clearOperatorSession({ notifyServer: true });
    else detachOperatorSession();
    audioContextRef.current?.close?.();
    audioContextRef.current = null;
  }, []);

  const handleContext = useCallback(async (cellId, machineId) => {
    try {
      await setContext(cellId, machineId, 'Posto de Reposição');
      toast.success('Posto operacional registrado no servidor.');
    } catch (error) {
      toast.error(error.message || 'Não foi possível registrar o posto.');
    }
  }, [setContext]);

  if (!selectedCellId) {
    return (
      <div className="min-h-full p-4 md:p-8">
        <div className="mx-auto mb-5 flex max-w-2xl items-center justify-between">
          <Button variant="ghost" onClick={() => navigate('/reposicao')}><ArrowLeft className="mr-2 h-4 w-4" /> Gestão</Button>
          <Button variant="outline" onClick={logout}><LogOut className="mr-2 h-4 w-4" /> Trocar operador</Button>
        </div>
        <ContextSelector session={{ ...session, cells, machines }} onConfirm={handleContext} loading={sessionLoading} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1760px] space-y-5 p-4 md:p-6">
      <header className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between md:p-5">
          <div className="flex items-start gap-3">
            <Button size="icon" variant="outline" className="rounded-xl" onClick={() => navigate('/reposicao')} aria-label="Voltar para gestão"><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-600">Produção de peça substituta</p>
              <h1 className="mt-1 text-balance text-xl font-black md:text-2xl">Posto de Reposição — {selectedCellName}</h1>
              <p className="mt-1 text-pretty text-xs text-muted-foreground">Visualize o que produzir, confira os dados técnicos e realize a baixa sequencial pela etiqueta da peça substituta.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1.5 px-3 py-2"><UserRound className="h-3.5 w-3.5" /> {operatorName} · {registration || 'matrícula validada'}</Badge>
            <Badge variant="outline" className="gap-1.5 border-amber-500/25 bg-amber-500/5 px-3 py-2 text-amber-700 dark:text-amber-300"><Factory className="h-3.5 w-3.5" /> {selectedCellName}</Badge>
            <Badge variant="outline" className="gap-1.5 px-3 py-2"><Settings2 className="h-3.5 w-3.5" /> {selectedMachineName || 'Posto da célula'}</Badge>
            <Badge variant="outline" className={`gap-1.5 px-3 py-2 ${online ? 'text-emerald-600' : 'text-rose-600'}`}>{online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{online ? 'Online' : 'Offline'}</Badge>
            <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={logout}><LogOut className="mr-2 h-4 w-4" /> Trocar operador</Button>
          </div>
        </div>
        <div className="grid border-t border-border/50 bg-secondary/15 sm:grid-cols-3">
          <HeaderDetail icon={PackageCheck} title="Produza somente o disponível" text="Itens a caminho não aceitam baixa antecipada." />
          <HeaderDetail icon={ScanLine} title="Bipe a peça substituta" text="A etiqueta original permanece reprovada." />
          <HeaderDetail icon={Route} title="Siga a sequência da rota" text="O servidor libera uma etapa por vez." />
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard icon={PackageCheck} label="Disponíveis agora" value={queue.summary?.available ?? queue.available?.length ?? 0} caption="Prontas nesta célula" tone="emerald" />
        <StatusCard icon={Truck} label="A caminho" value={queue.summary?.on_way ?? queue.on_way?.length ?? 0} caption="Etapas anteriores pendentes" tone="blue" />
        <StatusCard icon={CheckCircle2} label="Concluídas no turno" value={queue.summary?.completed ?? queue.completed?.length ?? 0} caption="Baixas confirmadas" tone="violet" />
        <StatusCard icon={RefreshCw} label="Fila local pendente" value={unsyncedCount} caption={unsyncedCount ? 'Aguardando sincronização' : 'Tudo sincronizado'} tone={unsyncedCount ? 'amber' : 'slate'} spin={flushing} />
        <StatusCard icon={BellRing} label="Realtime da célula" value={realtimeStatus === 'SUBSCRIBED' ? 'Ativo' : 'Conectando'} caption="Atualização entre computadores" tone={realtimeStatus === 'SUBSCRIBED' ? 'emerald' : 'amber'} />
      </section>

      <section className="overflow-hidden rounded-3xl border-2 border-amber-500/25 bg-card shadow-sm">
        <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="border-b border-amber-500/15 bg-amber-500/5 p-5 lg:border-b-0 lg:border-r md:p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600"><ScanLine className="h-5 w-5" /></div>
            <h2 className="mt-3 text-base font-black">Leitor de código de barras</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Bipe a etiqueta da peça substituta exibida em “Disponíveis agora”. O sistema valida célula, operador, máquina e sequência produtiva.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.error > 0 && <Button size="sm" variant="outline" onClick={retryQueueErrors}>Reprocessar {stats.error}</Button>}
              <Button size="sm" variant="outline" onClick={() => loadQueue()} disabled={loadingQueue}><RefreshCw className={`mr-2 h-4 w-4 ${loadingQueue ? 'animate-spin' : ''}`} /> Atualizar fila</Button>
            </div>
          </div>
          <div className="p-5 md:p-6">
            <form onSubmit={(event) => { event.preventDefault(); submitScan(barcode); }}>
              <Input
                ref={inputRef}
                value={barcode}
                onChange={handleBarcodeChange}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    window.clearTimeout(scanTimerRef.current);
                    submitScan(barcode);
                  }
                }}
                disabled={processing}
                autoComplete="off"
                aria-label="Código de barras da peça substituta"
                placeholder="Bipe a etiqueta da peça substituta"
                className="h-16 rounded-2xl border-amber-500/40 pl-4 font-mono text-base font-black shadow-inner focus-visible:ring-amber-500/30"
              />
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">Somente peças disponíveis nesta célula podem receber baixa. Uma bipagem antecipada será bloqueada sem alterar a produção.</p>
            {lastResult && (
              <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${lastResult.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : lastResult.result_status === 'offline_queued' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
                {lastResult.success ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <ShieldAlert className="h-5 w-5 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-bold">{lastResult.message}</p>
                  <p className="mt-1 break-all text-xs">{lastResult.reason_code || lastResult.result_status} · {lastResult.barcode}</p>
                  {lastResult.expected_stage && <p className="mt-1 text-xs">Etapa esperada: <strong>{lastResult.expected_stage}</strong></p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <QueueGroup title="Disponíveis agora" subtitle="Peças prontas para produção e baixa nesta célula" items={queue.available} icon={PackageCheck} loading={loadingQueue} />
        <QueueGroup title="A caminho" subtitle="Visão antecipada; a bipagem permanece bloqueada" items={queue.on_way} icon={Truck} informative loading={loadingQueue} />
      </section>

      <QueueGroup title="Últimas baixas do turno" subtitle="Confirmações persistidas pelo servidor neste posto" items={queue.completed} icon={CheckCircle2} completed loading={loadingQueue} />
    </div>
  );
}

function HeaderDetail({ icon: Icon, title, text }) {
  return <div className="flex gap-3 border-border/60 p-4 sm:border-r sm:last:border-r-0"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="text-xs font-bold">{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{text}</p></div></div>;
}

function StatusCard({ icon: Icon, label, value, caption, tone, spin = false }) {
  const tones = {
    emerald: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/15',
    blue: 'text-blue-600 bg-blue-500/10 border-blue-500/15',
    violet: 'text-violet-600 bg-violet-500/10 border-violet-500/15',
    amber: 'text-amber-600 bg-amber-500/10 border-amber-500/15',
    slate: 'text-slate-500 bg-slate-500/10 border-slate-500/15',
  };
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className={`inline-flex rounded-xl border p-2 ${tones[tone] || tones.slate}`}><Icon className={`h-4 w-4 ${spin ? 'animate-spin' : ''}`} /></div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{caption}</p>
    </div>
  );
}

function QueueGroup({ title, subtitle, items = [], icon: Icon, informative = false, completed = false, loading }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black"><Icon className="h-5 w-5 text-amber-500" /> {title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Badge variant="outline" className="min-w-9 justify-center rounded-full py-1 text-xs font-black">{items.length}</Badge>
      </div>
      {loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando fila...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <PackageCheck className="mx-auto mb-2 h-6 w-6 opacity-50" />
          <p className="font-semibold text-foreground">Nenhuma peça neste grupo</p>
          <p className="mt-1 text-xs">A lista será atualizada automaticamente quando houver movimentação.</p>
        </div>
      ) : (
        <div className={`grid gap-4 ${completed ? 'lg:grid-cols-2 2xl:grid-cols-3' : ''}`}>
          {items.map((item, index) => (
            <QueueCard key={item.reading_id || item.replacement_order_id || index} item={item} informative={informative} completed={completed} />
          ))}
        </div>
      )}
    </section>
  );
}

function FreshReplacementStation() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    clearOperatorSession({ notifyServer: true }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);

  if (!ready) {
    return <div className="flex min-h-[70vh] items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-amber-500" /></div>;
  }

  return (
    <OperationalLoginGate
      sessionPurpose="replacement"
      pageTitle="Posto de Reposição"
      pageSubtitle="BAIXA PRODUTIVA POR CÉLULA"
      pageDescription="Acesso exclusivo para colaboradores liberados no cadastro de operadores."
      submitLabel="Entrar no Posto de Reposição"
      accessTitle="Acesso autorizado à reposição"
      accessDescription="Informe seu login e matrícula. O servidor verificará sua liberação antes de abrir as células."
      icon={RotateCcw}
    >
      <ReplacementStation />
    </OperationalLoginGate>
  );
}

function ContextDetail({ icon: Icon, title, text }) {
  return (
    <div className="flex items-start gap-3 border-border/60 p-4 sm:border-r sm:last:border-r-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div><p className="text-xs font-bold">{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{text}</p></div>
    </div>
  );
}

export default FreshReplacementStation;

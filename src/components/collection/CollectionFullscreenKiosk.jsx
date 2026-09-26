import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Minimize2, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  User, 
  Activity, 
  RadioTower
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import CollectionRecentReadsPanel from '@/components/collection/CollectionRecentReadsPanel';
import ActiveDowntimeBanner from '@/components/collection/ActiveDowntimeBanner';
import CollectionLotBanner from '@/components/collection/CollectionLotBanner';

const METRIC_TONES = {
  slate: {
    card: 'bg-slate-900/90 border-slate-800 hover:border-slate-700',
    label: 'text-slate-400',
    value: 'text-slate-100',
    hint: 'text-slate-400',
    icon: 'text-slate-400',
  },
  emerald: {
    card: 'bg-emerald-950/40 border-emerald-500/30 hover:border-emerald-500/50',
    label: 'text-emerald-400',
    value: 'text-emerald-400',
    hint: 'text-emerald-300/70',
    icon: 'text-emerald-400',
  },
  rose: {
    card: 'bg-rose-950/40 border-rose-500/30 hover:border-rose-500/50',
    label: 'text-rose-400',
    value: 'text-rose-400',
    hint: 'text-rose-300/70',
    icon: 'text-rose-400',
  },
  amber: {
    card: 'bg-amber-950/40 border-amber-500/30 hover:border-amber-500/50',
    label: 'text-amber-400',
    value: 'text-amber-400',
    hint: 'text-amber-300/70',
    icon: 'text-amber-400',
  },
  sky: {
    card: 'bg-sky-950/40 border-sky-500/30 hover:border-sky-500/50',
    label: 'text-sky-300',
    value: 'text-sky-300',
    hint: 'text-sky-200/70',
    icon: 'text-sky-300',
  },
  lime: {
    card: 'bg-lime-950/35 border-lime-500/30 hover:border-lime-500/50',
    label: 'text-lime-300',
    value: 'text-lime-300',
    hint: 'text-lime-200/70',
    icon: 'text-lime-300',
  },
  red: {
    card: 'bg-red-950/40 border-red-500/30 hover:border-red-500/50',
    label: 'text-red-300',
    value: 'text-red-300',
    hint: 'text-red-200/70',
    icon: 'text-red-300',
  },
  violet: {
    card: 'bg-violet-950/40 border-violet-500/30 hover:border-violet-500/50',
    label: 'text-violet-300',
    value: 'text-violet-300',
    hint: 'text-violet-200/70',
    icon: 'text-violet-300',
  },
};

function KioskMetricCard({ label, value, hint, icon: Icon, tone }) {
  const color = METRIC_TONES[tone] || METRIC_TONES.slate;

  return (
    <div className={`flex min-h-[78px] items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg transition-colors ${color.card}`}>
      <div className="min-w-0">
        <p className={`truncate text-[10px] font-black uppercase tracking-wider ${color.label}`}>{label}</p>
        <p className={`mt-1 font-mono text-2xl font-black leading-none tabular-nums sm:text-3xl ${color.value}`}>{value}</p>
        {hint && <p className={`mt-1 truncate text-[10px] font-semibold ${color.hint}`}>{hint}</p>}
      </div>
      <Icon className={`h-4 w-4 shrink-0 ${color.icon}`} />
    </div>
  );
}

export default function CollectionFullscreenKiosk({
  open,
  onClose,
  cellId,
  cellName,
  machine,
  shift,
  operator,
  operatorId,
  mode,
  setMode,
  handleRead,
  feedback,
  cellStats,
  currentGeneralLot,
  currentClientLotCode,
  currentCustomerName,
  currentClientLotProgress,
  activeDowntime,
  refetchActiveDowntime,
  refreshData,
  onOpenDowntime,
  selectedPiece,
  onSelectPiece,
  handleOpenRejectModal,
  handleOpenReadingOccurrence,
  handleOpenTraceabilityDrawer,
  refreshReadsSignal,
  contextReady,
  contextMessage,
  realtimeEnabled = true,
  periodicReconciliationEnabled = true,
  localResultGenerationRef,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  // Ativar fullscreen nativo quando o modo kiosk for aberto
  useEffect(() => {
    if (open) {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [open]);

  // Tecla ESC para sair do modo tela cheia
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const lotExpected = cellStats?.expected ?? '—';
  const lotApproved = cellStats?.approved ?? '—';
  const lotRejected = cellStats?.rejected ?? '—';
  const lotPending = cellStats?.pending ?? '—';
  const producedInShift = cellStats?.shiftProduced ?? ((Number(cellStats?.shiftApproved) || 0) + (Number(cellStats?.shiftRejected) || 0));
  const shiftApproved = cellStats?.shiftApproved ?? 0;
  const shiftRejected = cellStats?.shiftRejected ?? 0;
  const shiftBlocked = cellStats?.shiftBlocked ?? 0;

  const kioskMarkup = (
    <div 
      className="fixed left-0 top-0 right-0 bottom-0 z-[9999] flex h-[100dvh] w-[100dvw] max-h-[100dvh] max-w-[100dvw] flex-col overflow-y-auto overscroll-contain bg-slate-950 text-slate-100 select-none"
      style={{ margin: 0 }}
      data-testid="collection-fullscreen-kiosk"
    >
      {/* ─── Top Bar Operacional ────────────────────────────────────────────── */}
      <header className="shrink-0 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Coleta em Modo Foco (Kiosk)
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-slate-300 border-l border-slate-700 pl-3">
            <span className="text-slate-400">Célula:</span>
            <span className="bg-slate-800 text-emerald-300 px-2.5 py-1 rounded-lg border border-slate-700 font-mono font-bold">
              {cellName || 'N/A'}
            </span>
          </div>

          {machine?.name && (
            <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-slate-300">
              <span className="text-slate-400">Posto:</span>
              <span className="bg-slate-800 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 font-mono">
                {machine.name}
              </span>
            </div>
          )}

          <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-slate-300">
            <span className="text-slate-400">Turno:</span>
            <span className="bg-slate-800 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700">
              {shift}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Informações de Operador */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-xs text-slate-200">
            <User className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold truncate max-w-[140px] sm:max-w-[200px]">{operator || 'Operador'}</span>
          </div>

          {/* Botão Registro de Parada */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDowntime}
            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs font-bold gap-1.5 h-9 rounded-xl transition-all"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 animate-bounce" />
            <span className="hidden sm:inline">Registrar</span> Parada
          </Button>

          {/* Botão Sair da Tela Cheia */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold gap-1.5 h-9 rounded-xl"
            title="Sair do Modo Foco (ESC)"
          >
            <Minimize2 className="w-4 h-4 text-slate-300" />
            <span className="hidden sm:inline">Sair Tela Cheia</span>
          </Button>
        </div>
      </header>

      {/* ─── Banner de Parada Ativa se existir ────────────────────────────── */}
      {activeDowntime && (
        <div className="p-4 sm:px-6 bg-slate-950">
          <ActiveDowntimeBanner
            activeDowntime={activeDowntime}
            onDowntimeFinished={() => {
              refetchActiveDowntime?.();
              refreshData?.();
            }}
          />
        </div>
      )}

      {/* ─── Conteúdo Principal Kiosk ───────────────────────────────────────── */}
      <main className="flex-1 p-3 sm:p-4 space-y-4 max-w-[1800px] w-full mx-auto">

        {/* 1. Lotes em Andamento & Progresso Geral Banner */}
        <CollectionLotBanner
          generalLot={currentGeneralLot}
          clientLotCode={currentClientLotCode}
          customerName={currentCustomerName}
          clientLotProgress={currentClientLotProgress}
          cellStats={cellStats}
          focus
        />

        {/* 2. Indicadores do lote geral em coleta */}
        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
            Lote geral em coleta
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KioskMetricCard label="Previsto" value={lotExpected} hint="Total da célula" icon={Activity} tone="slate" />
            <KioskMetricCard label="Aprovado" value={lotApproved} hint="Sucesso no lote" icon={CheckCircle2} tone="emerald" />
            <KioskMetricCard label="Reprovado" value={lotRejected} hint="NC do lote" icon={XCircle} tone="rose" />
            <KioskMetricCard label="Pendente" value={lotPending} hint="Aguardando bipagem" icon={Clock} tone="amber" />
          </div>
        </section>

        {/* 3. Indicadores do turno da estação */}
        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
            Turno da estação
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KioskMetricCard label="Produção no turno" value={producedInShift} hint="Aprov. + reprov." icon={Activity} tone="sky" />
            <KioskMetricCard label="Aprovadas no turno" value={shiftApproved} hint="Nesta estação" icon={CheckCircle2} tone="lime" />
            <KioskMetricCard label="Reprovadas no turno" value={shiftRejected} hint="NC no turno" icon={XCircle} tone="red" />
            <KioskMetricCard label="Bloqueadas no turno" value={shiftBlocked} hint="Bloqueios do turno" icon={Clock} tone="violet" />
          </div>
        </section>

        {/* 4. Área de Coleta Principal (Bipagem / Scanner Físico / Câmera / Manual) */}
        <section className="grid lg:grid-cols-[1.5fr_1fr] gap-6 items-start">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <RadioTower className="w-4 h-4 text-emerald-400" />
                Área de Coleta e Leitura
              </h3>
              <span className="text-xs font-mono text-slate-400 bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
                {mode === 'scanner' ? 'Leitor Físico' : mode === 'camera' ? 'Câmera' : 'Digitação Manual'}
              </span>
            </div>

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
              contextReady={contextReady}
              contextMessage={contextMessage}
              onOpenDowntime={onOpenDowntime}
              activeDowntime={activeDowntime}
            />
          </div>

          {/* 5. Painel de Leituras Recentes em Tempo Real */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl h-full flex flex-col">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Histórico Recente da Estação
            </h3>
            <div className="flex-1 min-h-[350px]">
              <CollectionRecentReadsPanel
                cellId={cellId}
                cellName={cellName}
                workstationId={machine?.id}
                operatorId={operatorId}
                shift={shift}
                selectedPiece={selectedPiece}
                onSelectPiece={onSelectPiece}
                onRejectPiece={handleOpenRejectModal}
                onCreateOccurrence={handleOpenReadingOccurrence}
                onOpenTraceability={handleOpenTraceabilityDrawer}
                refreshSignal={refreshReadsSignal}
                canReject={true}
                realtimeEnabled={realtimeEnabled}
                periodicReconciliationEnabled={periodicReconciliationEnabled}
                refetchOnMount={false}
                localResultGenerationRef={localResultGenerationRef}
              />
            </div>
          </div>
        </section>

      </main>
    </div>
  );

  return createPortal(kioskMarkup, document.body);
}

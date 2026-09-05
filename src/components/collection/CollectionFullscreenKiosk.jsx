import React, { useEffect } from 'react';
import { 
  Minimize2, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Layers, 
  User, 
  Activity, 
  Box, 
  RadioTower
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import CollectionRecentReadsPanel from '@/components/collection/CollectionRecentReadsPanel';
import ActiveDowntimeBanner from '@/components/collection/ActiveDowntimeBanner';

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
}) {
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

  const expected = cellStats?.expected ?? 0;
  const approved = cellStats?.approved ?? 0;
  const rejected = cellStats?.rejected ?? 0;
  const pending = cellStats?.pending ?? 0;
  const progressPercent = Number(currentGeneralLot?.progress_percent || 0);

  return (
    <div 
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto select-none"
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
      <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-[1800px] w-full mx-auto">

        {/* 1. Lotes em Andamento & Progresso Geral Banner */}
        <section className="rounded-3xl border-2 border-emerald-500/40 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 p-5 sm:p-6 shadow-2xl shadow-emerald-950/20 relative overflow-hidden">
          {/* Efeito luminoso de fundo */}
          <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr_1fr] items-center relative z-10">
            {/* Lote Geral */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-300">
                  Lote Geral em Andamento
                </span>
              </div>
              <p className="font-mono text-3xl sm:text-5xl font-black tracking-tight text-white drop-shadow-md">
                {currentGeneralLot?.general_lot_code || 'AGUARDANDO LOTE'}
              </p>
            </div>

            {/* Lote do Cliente */}
            <div className="space-y-1 lg:border-l lg:border-slate-800 lg:pl-6">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-300">
                  Lote do Cliente
                </span>
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-extrabold text-slate-100 truncate">
                {currentClientLotCode || 'Sem bipagem'}
              </p>
              {feedback?.order?.customer_name && (
                <p className="text-xs font-semibold text-emerald-200/80 truncate">
                  {feedback.order.customer_name}
                </p>
              )}
            </div>

            {/* Andamento Geral */}
            <div className="space-y-2 lg:border-l lg:border-slate-800 lg:pl-6">
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-300">
                  Andamento Geral
                </span>
                <span className="font-mono text-2xl font-black text-emerald-400">
                  {progressPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
              </div>

              {/* Barra de Progresso Reluzente */}
              <div className="h-4 w-full bg-slate-800/90 rounded-full p-0.5 overflow-hidden border border-slate-700">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 shadow-lg shadow-emerald-500/50"
                  style={{ width: `${Math.min(Math.max(progressPercent, 0), 100)}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 2. Os 4 KPIs Fundamentais (Previsto, Aprovado, Reprovado, Pendente) */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* PREVISTO */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-3 hover:border-slate-700 transition-colors">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Previsto</span>
              <Activity className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <p className="text-4xl sm:text-5xl font-black font-mono text-slate-100 tabular-nums">{expected}</p>
              <p className="text-[11px] text-slate-400 mt-1">Total de peças para a célula</p>
            </div>
          </div>

          {/* APROVADO */}
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-3 hover:border-emerald-500/50 transition-colors">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Aprovado</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-4xl sm:text-5xl font-black font-mono text-emerald-400 tabular-nums">{approved}</p>
              <p className="text-[11px] text-emerald-300/70 mt-1">Peças bipadas com sucesso</p>
            </div>
          </div>

          {/* REPROVADO */}
          <div className="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-3 hover:border-rose-500/50 transition-colors">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400">Reprovado</span>
              <XCircle className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <p className="text-4xl sm:text-5xl font-black font-mono text-rose-400 tabular-nums">{rejected}</p>
              <p className="text-[11px] text-rose-300/70 mt-1">Defeitos / Não conformidades</p>
            </div>
          </div>

          {/* PENDENTE */}
          <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-3 hover:border-amber-500/50 transition-colors">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Pendente</span>
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-4xl sm:text-5xl font-black font-mono text-amber-400 tabular-nums">{pending}</p>
              <p className="text-[11px] text-amber-300/70 mt-1">Peças aguardando bipagem</p>
            </div>
          </div>
        </section>

        {/* 3. Área de Coleta Principal (Bipagem / Scanner Físico / Câmera / Manual) */}
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

          {/* 4. Painel de Leituras Recentes em Tempo Real */}
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
              />
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

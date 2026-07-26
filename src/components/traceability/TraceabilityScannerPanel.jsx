import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, Lock } from 'lucide-react';
import ProductionTagInput from './ProductionTagInput';
import ScannerModeSelector from './ScannerModeSelector';
import MobileCameraScanner from './MobileCameraScanner';

export default function TraceabilityScannerPanel({
  mode,
  onModeChange,
  onRead,
  loading,
  feedback,
  cellName,
  shift,
  operator,
  machine,
  readerContext,
  onOpenDowntime,
  activeDowntime,
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const contextReady = Boolean(cellName && shift && operator) && !activeDowntime;

  const refocus = useCallback(() => {
    if (mode !== 'scanner' || activeDowntime) return;
    setTimeout(() => {
      const activeElement = document.activeElement;
      const userIsUsingAnotherControl = activeElement
        && activeElement !== document.body
        && activeElement !== inputRef.current
        && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName);
      if (!userIsUsingAnotherControl) inputRef.current?.focus();
    }, 40);
  }, [mode, activeDowntime]);

  useEffect(() => {
    refocus();
  }, [mode, refocus]);

  const submitInput = useCallback(async ({ confirmed = mode !== 'manual' } = {}) => {
    const rawValue = value;
    if (!String(rawValue || '').trim() || !contextReady || loading || submittingRef.current || activeDowntime) return;
    submittingRef.current = true;
    try {
      await onRead({
        rawValue,
        readerType: mode === 'manual' ? 'manual' : 'keyboard_barcode',
        readerName: mode === 'manual' ? 'Digitação Manual' : 'Scanner Teclado',
        mode,
        confirmed,
        cellName,
        stationName: cellName,
        operator,
        shift,
        machineId: machine?.id || null,
        machineName: machine?.name || null,
      });
      setValue('');
    } finally {
      submittingRef.current = false;
      if (mode === 'scanner') setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [cellName, contextReady, loading, mode, onRead, operator, shift, value, machine, activeDowntime]);

  useEffect(() => {
    if (mode !== 'scanner' || !contextReady || loading || value.trim().length < 3 || activeDowntime) return undefined;
    const autoSubmitTimer = setTimeout(() => submitInput(), 160);
    return () => clearTimeout(autoSubmitTimer);
  }, [contextReady, loading, mode, submitInput, value, activeDowntime]);

  const submitCamera = useCallback((cameraReading) => {
    if (activeDowntime) return;
    onRead({
      ...cameraReading,
      cellName,
      stationName: '',
      operator,
      shift,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
    });
  }, [onRead, cellName, operator, shift, machine, activeDowntime]);

  useEffect(() => {
    if (!feedback) return;
    
    const playSound = (alertLevel) => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        
        if (alertLevel === 'green') {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
        } else {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(659.25, ctx.currentTime);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        }
      } catch (error) {
        console.error('Falha na execução do áudio de bip:', error);
      }
    };

    const level = feedback.alert_level || (feedback.success ? 'green' : 'red');
    playSound(level);
  }, [feedback]);

  return (
    <div className="bg-card border border-border rounded-md p-4 sm:p-5 space-y-5">
      <ScannerModeSelector value={mode} onChange={onModeChange} onOpenDowntime={onOpenDowntime} />

      {activeDowntime ? (
        <div className="rounded-2xl border-2 border-amber-600/60 bg-amber-500/10 p-5 text-amber-900 dark:text-amber-200 space-y-2 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-black text-sm uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <Lock className="w-5 h-5 text-amber-600 animate-pulse shrink-0" />
            <span>SISTEMA DE COLETA BLOQUEADO POR PARADA EM ANDAMENTO</span>
          </div>
          <p className="text-xs leading-relaxed font-medium">
            Parada ativa: <strong className="font-bold text-foreground">{activeDowntime.reason || 'Parada Operacional'}</strong>. A baixa e leitura de peças ficam travadas até que o cronômetro da parada seja encerrado no painel acima.
          </p>
        </div>
      ) : (
        <>
          {!contextReady && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
              Selecione a célula e confirme o turno para liberar a coleta.
            </div>
          )}

          {mode === 'camera' ? (
            contextReady
              ? <MobileCameraScanner active onDetected={submitCamera} onManual={() => onModeChange('manual')} feedback={feedback} />
              : null
          ) : (
            <ProductionTagInput
              ref={inputRef}
              mode={mode}
              value={value}
              onChange={setValue}
              onSubmit={submitInput}
              onBlur={refocus}
              loading={loading}
              ready={contextReady}
              afterInput={readerContext}
            />
          )}

          {mode === 'camera' && readerContext}
        </>
      )}

      {feedback && (
        <div
          role="status"
          data-status={feedback.status}
          className={`rounded-xl border p-4 shadow-md transition-all flex flex-col gap-1.5 ${
            feedback.alert_level === 'red' || ['rejected', 'blocked', 'error'].includes(feedback.status)
              ? 'border-red-300 border-red-500/30 bg-red-500/5 text-red-600 dark:bg-red-950/10 dark:text-red-400'
              : feedback.alert_level === 'yellow' || feedback.status === 'duplicated' || feedback.status === 'warning' || feedback.status === 'wrong_step'
                ? 'border-amber-300 border-amber-500/30 bg-amber-500/5 text-amber-600 dark:bg-amber-950/10 dark:text-amber-400'
                : feedback.alert_level === 'blue'
                  ? 'border-blue-500/30 bg-blue-500/5 text-blue-600 dark:bg-blue-950/10 dark:text-blue-400'
                  : 'border-emerald-300 border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-base uppercase tracking-wide">
            {feedback.alert_level === 'red' || ['rejected', 'blocked', 'error'].includes(feedback.status) ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                ENTRADA BLOQUEADA
              </>
            ) : feedback.alert_level === 'yellow' || feedback.status === 'duplicated' || feedback.status === 'warning' ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                ATENÇÃO DO OPERADOR
              </>
            ) : feedback.alert_level === 'blue' ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                INFORMAÇÃO DO FLUXO
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                PEÇA LIBERADA — OK
              </>
            )}
          </div>
          <p className="text-sm font-medium leading-relaxed">{feedback.message}</p>
          {(feedback.item || feedback.lot || feedback.order) && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 pt-2 mt-1 border-t border-current/15 text-xs">
              <div>
                <span className="block opacity-70">Peça</span>
                <strong className="font-mono break-all">{feedback.item?.traceability_code || feedback.item?.piece_uid || feedback.reading?.tag_value || '—'}</strong>
              </div>
              <div>
                <span className="block opacity-70">Lote cliente</span>
                <strong>{feedback.lot?.lot_code || '—'}</strong>
              </div>
              <div>
                <span className="block opacity-70">Pedido / OP</span>
                <strong>{feedback.order?.order_number || feedback.order?.order_code || '—'}</strong>
              </div>
              <div>
                <span className="block opacity-70">Cliente</span>
                <strong>{feedback.order?.customer_name || '—'}</strong>
              </div>
              <div>
                <span className="block opacity-70">Andamento do lote</span>
                <strong>{Number(feedback.lot_progress_percent ?? feedback.lot?.progress_percent ?? 0).toFixed(1)}%</strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border pt-3">
        <Info className="w-4 h-4 shrink-0" />
        <span>Célula: <strong className="text-foreground">{cellName || 'não selecionada'}</strong>{machine && <> · Máquina: <strong className="text-foreground">{machine.name}</strong></>} · Turno: <strong className="text-foreground">{shift || 'não informado'}</strong> · Operador: <strong className="text-foreground">{operator || 'não informado'}</strong></span>
      </div>
    </div>
  );
}

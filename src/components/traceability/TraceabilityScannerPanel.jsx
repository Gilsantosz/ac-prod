import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, Lock } from 'lucide-react';
import ProductionTagInput from './ProductionTagInput';
import ScannerModeSelector from './ScannerModeSelector';
import MobileCameraScanner from './MobileCameraScanner';
import {
  getProductionScanCodeError,
  parseProductionScanCode,
  PRODUCTION_SCAN_LENGTH,
} from '@/lib/productionScanCode';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
  getCollectionStatePresentation,
} from '@/lib/collectionStateMachine';

const DUPLICATE_TRIGGER_GUARD_MS = 250;

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
  onToggleKiosk,
  activeDowntime,
  volumeEntry,
  modalOpen = false,
}) {
  const [value, setValue] = useState('');
  const [scanError, setScanError] = useState(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const inputRef = useRef(null);
  const lastCaptureRef = useRef({ code: null, at: 0 });
  const mountedRef = useRef(true);
  const refocusTimerRef = useRef(null);
  const lastApprovalSoundRef = useRef(null);
  const isSuspended = activeDowntime || modalOpen;
  const contextReady = Boolean(cellName && shift && operator) && !isSuspended;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
    };
  }, []);

  const refocus = useCallback(() => {
    if (mode !== 'scanner' || isSuspended) return;
    if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
    refocusTimerRef.current = setTimeout(() => {
      refocusTimerRef.current = null;
      if (!mountedRef.current || typeof document === 'undefined') return;
      const activeElement = document.activeElement;
      const hasOpenDialog = Boolean(document.querySelector('[role="dialog"], [data-state="open"]'));
      const userIsUsingAnotherControl = (activeElement
        && activeElement !== document.body
        && activeElement !== inputRef.current
        && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(activeElement.tagName)) || hasOpenDialog;
      if (!userIsUsingAnotherControl) inputRef.current?.focus();
    }, 20);
  }, [mode, isSuspended]);

  useEffect(() => {
    refocus();
  }, [mode, refocus]);

  useEffect(() => {
    if (feedback) setScanError(null);
  }, [feedback]);

  const dispatchCapturedReading = useCallback((code, options = {}) => {
    if (!contextReady || activeDowntime) {
      setScanError('A coleta está bloqueada até que a célula, o turno e o operador estejam disponíveis.');
      return false;
    }

    const parsed = parseProductionScanCode(code);
    if (!parsed.valid) {
      setScanError(getProductionScanCodeError(code));
      return false;
    }

    const now = performance.now();
    if (
      lastCaptureRef.current.code === parsed.value
      && now - lastCaptureRef.current.at < DUPLICATE_TRIGGER_GUARD_MS
    ) {
      return false;
    }
    lastCaptureRef.current = { code: parsed.value, at: now };

    // Libera o campo antes de qualquer acesso ao IndexedDB ou à rede. Assim o
    // próximo código já pode ser recebido enquanto o anterior sincroniza.
    setValue('');
    setScanError(null);
    setCapturedCount((current) => current + 1);

    const readerType = options.readerType
      || (mode === 'manual' ? 'manual' : 'keyboard_barcode');
    const readerName = options.readerName
      || (mode === 'manual' ? 'Digitação Manual' : 'Scanner Teclado');
    const capturedAtClient = new Date().toISOString();

    Promise.resolve(onRead({
      ...(options.extraPayload || {}),
      rawValue: parsed.value,
      readerType,
      readerName,
      mode: options.mode || mode,
      confirmed: options.confirmed ?? (mode !== 'manual'),
      cellName,
      stationName: options.stationName ?? cellName,
      operator,
      shift,
      machineId: machine?.id || null,
      machineName: machine?.name || null,
      fastPath: true,
      exactDigitCapture: true,
      expectedCodeLength: PRODUCTION_SCAN_LENGTH,
      capturedAtClient,
    }))
      .catch((error) => {
        console.error('Falha ao encaminhar leitura capturada:', error);
        if (mountedRef.current) {
          setScanError(error?.message || 'A leitura foi capturada, mas houve falha ao iniciar a sincronização.');
        }
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setCapturedCount((current) => Math.max(0, current - 1));
        refocus();
      });

    refocus();
    return true;
  }, [activeDowntime, cellName, contextReady, machine, mode, onRead, operator, refocus, shift]);

  const handleValueChange = useCallback((rawValue) => {
    const parsed = parseProductionScanCode(rawValue);

    if (parsed.hasUnsupportedCharacters || parsed.overflow) {
      setValue('');
      setScanError(getProductionScanCodeError(rawValue));
      refocus();
      return;
    }

    setValue(parsed.value);
    setScanError(null);

    if (mode === 'scanner' && parsed.valid) {
      dispatchCapturedReading(parsed.value, {
        readerType: 'keyboard_barcode',
        readerName: 'Scanner Teclado',
        mode: 'scanner',
        confirmed: true,
      });
    }
  }, [dispatchCapturedReading, mode, refocus]);

  const submitInput = useCallback(({ confirmed = mode !== 'manual' } = {}) => {
    const parsed = parseProductionScanCode(value);
    if (!parsed.valid) {
      setScanError(getProductionScanCodeError(value));
      return;
    }
    if (mode === 'manual' && !confirmed) {
      setScanError('Confirme que os 8 dígitos foram conferidos antes da baixa manual.');
      return;
    }

    dispatchCapturedReading(parsed.value, {
      readerType: mode === 'manual' ? 'manual' : 'keyboard_barcode',
      readerName: mode === 'manual' ? 'Digitação Manual' : 'Scanner Teclado',
      mode,
      confirmed,
    });
  }, [dispatchCapturedReading, mode, value]);

  const submitCamera = useCallback((cameraReading) => {
    if (activeDowntime) return;
    const rawValue = cameraReading?.rawValue
      ?? cameraReading?.raw_value
      ?? cameraReading?.tagValue
      ?? '';
    const parsed = parseProductionScanCode(rawValue);
    if (!parsed.valid) {
      setScanError(getProductionScanCodeError(rawValue));
      return;
    }

    dispatchCapturedReading(parsed.value, {
      readerType: cameraReading?.readerType || 'camera_barcode',
      readerName: cameraReading?.readerName || 'Câmera do celular',
      mode: 'camera',
      confirmed: true,
      stationName: '',
      extraPayload: cameraReading,
    });
  }, [activeDowntime, dispatchCapturedReading]);

  useEffect(() => {
    if (!feedback) return;
    const state = collectionStateFromResult(feedback);
    if (state !== COLLECTION_STATES.APPROVED) return;
    const soundKey = `${feedback.client_event_id || feedback.reading?.id || 'approved'}:${state}`;
    if (lastApprovalSoundRef.current === soundKey) return;
    lastApprovalSoundRef.current = soundKey;

    const playApprovalSound = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.onended = () => ctx.close?.();
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } catch (error) {
        console.error('Falha na execução do áudio de bip:', error);
      }
    };

    playApprovalSound();
  }, [feedback]);

  const feedbackPresentation = feedback
    ? getCollectionStatePresentation(collectionStateFromResult(feedback))
    : null;
  const feedbackTone = feedbackPresentation?.tone || 'neutral';

  return (
    <div className="space-y-5 rounded-md border border-border bg-card p-4 sm:p-5">
      <ScannerModeSelector value={mode} onChange={onModeChange} onOpenDowntime={onOpenDowntime} onToggleKiosk={onToggleKiosk} />

      {activeDowntime ? (
        <div className="space-y-2 rounded-2xl border-2 border-amber-600/60 bg-amber-500/10 p-5 text-amber-900 shadow-md animate-in fade-in duration-200 dark:text-amber-200">
          <div className="flex items-center gap-2.5 text-sm font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <Lock className="h-5 w-5 shrink-0 animate-pulse text-amber-600" />
            <span>SISTEMA DE COLETA BLOQUEADO POR PARADA EM ANDAMENTO</span>
          </div>
          <p className="text-xs font-medium leading-relaxed">
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

          {mode === 'volume' ? (
            volumeEntry
          ) : mode === 'camera' ? (
            contextReady
              ? <MobileCameraScanner active onDetected={submitCamera} onManual={() => onModeChange('manual')} feedback={feedback} />
              : null
          ) : (
            <ProductionTagInput
              ref={inputRef}
              mode={mode}
              value={value}
              onChange={handleValueChange}
              onSubmit={submitInput}
              onBlur={refocus}
              loading={loading}
              ready={contextReady}
              afterInput={readerContext}
              scanError={scanError}
              capturedCount={capturedCount}
            />
          )}

          {mode === 'camera' && readerContext}
        </>
      )}

      {feedback && (
        <div
          role="status"
          data-status={feedback.status}
          data-collection-state={feedbackPresentation.state}
          className={`flex flex-col gap-1.5 rounded-xl border p-4 shadow-md transition-all ${
            feedbackTone === 'danger'
              ? 'border-red-300 border-red-500/30 bg-red-500/5 text-red-600 dark:bg-red-950/10 dark:text-red-400'
              : feedbackTone === 'warning'
                ? 'border-amber-300 border-amber-500/30 bg-amber-500/5 text-amber-600 dark:bg-amber-950/10 dark:text-amber-400'
                : feedbackTone === 'neutral'
                  ? 'border-blue-500/30 bg-blue-500/5 text-blue-600 dark:bg-blue-950/10 dark:text-blue-400'
                  : 'border-emerald-300 border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:bg-emerald-950/10 dark:text-emerald-400'
          }`}
        >
          <div className="flex items-center gap-2 text-base font-bold uppercase tracking-wide">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              feedbackTone === 'approved'
                ? 'bg-emerald-500'
                : feedbackTone === 'danger'
                  ? 'bg-red-500'
                  : feedbackTone === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-blue-500'
            }`} />
            {feedbackPresentation.label}
          </div>
          <p className="text-sm font-medium leading-relaxed">
            {feedback.message || feedbackPresentation.defaultMessage}
          </p>
          {(feedback.item || feedback.lot || feedback.order) && (
            <div className="mt-1 grid grid-cols-2 gap-2 border-t border-current/15 pt-2 text-xs lg:grid-cols-5">
              <div><span className="block opacity-70">Peça</span><strong className="break-all font-mono">{feedback.item?.traceability_code || feedback.item?.piece_uid || feedback.reading?.tag_value || '—'}</strong></div>
              <div><span className="block opacity-70">Lote cliente</span><strong>{feedback.lot?.lot_code || '—'}</strong></div>
              <div><span className="block opacity-70">Pedido / OP</span><strong>{feedback.order?.order_number || feedback.order?.order_code || '—'}</strong></div>
              <div><span className="block opacity-70">Cliente</span><strong>{feedback.order?.customer_name || '—'}</strong></div>
              <div><span className="block opacity-70">Andamento do lote</span><strong>{Number(feedback.lot_progress_percent ?? feedback.lot?.progress_percent ?? 0).toFixed(1)}%</strong></div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" />
        <span>Célula: <strong className="text-foreground">{cellName || 'não selecionada'}</strong>{machine && <> · Máquina: <strong className="text-foreground">{machine.name}</strong></>} · Turno: <strong className="text-foreground">{shift || 'não informado'}</strong> · Operador: <strong className="text-foreground">{operator || 'não informado'}</strong></span>
      </div>
    </div>
  );
}

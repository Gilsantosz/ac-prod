import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, RadioTower } from 'lucide-react';
import ProductionTagInput from './ProductionTagInput';
import ScannerModeSelector from './ScannerModeSelector';
import MobileCameraScanner from './MobileCameraScanner';
import RfidReadinessPanel from './RfidReadinessPanel';

export default function TraceabilityScannerPanel({ mode, onModeChange, onRead, loading, feedback, cellName, shift, operator }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const contextReady = Boolean(cellName && shift && operator);

  const refocus = useCallback(() => {
    if (mode !== 'scanner') return;
    setTimeout(() => {
      const activeElement = document.activeElement;
      const userIsUsingAnotherControl = activeElement
        && activeElement !== document.body
        && activeElement !== inputRef.current;
      if (!userIsUsingAnotherControl) inputRef.current?.focus();
    }, 40);
  }, [mode]);

  useEffect(() => {
    refocus();
  }, [mode, refocus]);

  const submitInput = useCallback(async ({ confirmed = mode !== 'manual' } = {}) => {
    const rawValue = value;
    if (!String(rawValue || '').trim() || !contextReady || loading || submittingRef.current) return;
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
      });
      setValue('');
    } finally {
      submittingRef.current = false;
      if (mode === 'scanner') setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [cellName, contextReady, loading, mode, onRead, operator, shift, value]);

  useEffect(() => {
    if (mode !== 'scanner' || !contextReady || loading || value.trim().length < 3) return undefined;
    const autoSubmitTimer = setTimeout(() => submitInput(), 160);
    return () => clearTimeout(autoSubmitTimer);
  }, [contextReady, loading, mode, submitInput, value]);

  const submitCamera = useCallback((cameraReading) => onRead({
    ...cameraReading,
    cellName,
    stationName: '',
    operator,
    shift,
  }), [onRead, cellName, operator, shift]);

  return (
    <div className="bg-card border border-border rounded-md p-4 sm:p-5 space-y-5">
      <ScannerModeSelector value={mode} onChange={onModeChange} />

      {!contextReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          Selecione a célula e confirme o turno para liberar a coleta.
        </div>
      )}

      {mode === 'camera' ? (
        contextReady
          ? <MobileCameraScanner active onDetected={submitCamera} onManual={() => onModeChange('manual')} feedback={feedback} />
          : null
      ) : mode === 'rfid' ? (
        <div className="space-y-4">
          <div className="min-h-36 rounded-md border border-dashed border-sky-300 bg-sky-50/60 dark:bg-sky-950/20 flex flex-col items-center justify-center text-center p-6">
            <RadioTower className="w-9 h-9 text-sky-600 mb-3" />
            <p className="font-semibold">Preparado para integração futura</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">A baixa RFID usará a mesma validação de lote, etapa, célula e duplicidade.</p>
          </div>
          <RfidReadinessPanel active />
        </div>
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
        />
      )}

      {feedback && (
        <div
          role="status"
          data-status={feedback.status}
          className={`rounded-md border px-3 py-2 text-sm ${
            feedback.success
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
              : ['rejected', 'blocked', 'error'].includes(feedback.status)
                ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'
                : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          <strong>{feedback.success ? 'Leitura aprovada. ' : 'Leitura não aprovada. '}</strong>
          {feedback.message}
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border pt-3">
        <Info className="w-4 h-4 shrink-0" />
        <span>Célula: <strong className="text-foreground">{cellName || 'não selecionada'}</strong> · Turno: <strong className="text-foreground">{shift || 'não informado'}</strong> · Operador: <strong className="text-foreground">{operator || 'não informado'}</strong></span>
      </div>
    </div>
  );
}

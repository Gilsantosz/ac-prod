import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Barcode, CheckCircle2, Keyboard, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PRODUCTION_SCAN_LENGTH } from '@/lib/productionScanCode';

const ProductionTagInput = forwardRef(function ProductionTagInput({
  mode,
  value,
  onChange,
  onSubmit,
  onBlur,
  loading,
  ready = true,
  afterInput,
  scanError = null,
  capturedCount = 0,
}, ref) {
  const [confirmed, setConfirmed] = useState(false);
  const manual = mode === 'manual';
  const digitCount = String(value || '').length;
  const complete = digitCount === PRODUCTION_SCAN_LENGTH;

  useEffect(() => {
    if (!manual || !value) setConfirmed(false);
  }, [manual, value]);

  const submit = (event) => {
    event.preventDefault();
    if (!ready || !complete || (manual && !confirmed)) return;
    onSubmit?.({ confirmed: manual ? confirmed : true });
  };

  const helperText = useMemo(() => {
    if (manual) return `Digite exatamente ${PRODUCTION_SCAN_LENGTH} dígitos e confirme a identificação.`;
    if (capturedCount > 0) return `${capturedCount} leitura(s) capturada(s) localmente e aguardando confirmação do servidor.`;
    return `A coleta é disparada automaticamente no ${PRODUCTION_SCAN_LENGTH}º dígito — não é necessário pressionar Enter.`;
  }, [capturedCount, manual]);

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="relative">
        {manual
          ? <Keyboard className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
          : <Barcode className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-[#2d9c4a]" />}
        <Input
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder="Leia os 8 dígitos da etiqueta — ex.: 09950001"
          autoComplete="off"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={PRODUCTION_SCAN_LENGTH}
          disabled={!ready || (manual && loading)}
          className="h-16 rounded-md border-2 border-border bg-background pl-14 pr-24 text-base font-semibold tracking-[0.12em] focus:border-[#2d9c4a] sm:h-20 sm:text-xl"
          aria-label="Identificação produtiva"
          aria-describedby="production-scan-helper production-scan-error"
        />
        <span className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 font-mono text-xs font-black tabular-nums ${
          complete
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-border bg-secondary/50 text-muted-foreground'
        }`}>
          {digitCount}/{PRODUCTION_SCAN_LENGTH}
        </span>
      </div>

      <div id="production-scan-helper" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {!manual && <Zap className="h-4 w-4 shrink-0 text-amber-500" />}
        <span>{helperText}</span>
      </div>

      {scanError && (
        <div id="production-scan-error" role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300">
          {scanError}
        </div>
      )}

      {afterInput}

      {manual && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4 accent-[#00522d]" />
            Confirmo que conferi os 8 dígitos informados.
          </label>
          <Button type="submit" disabled={!ready || loading || !complete || !confirmed} className="h-11 w-full gap-2 sm:w-auto">
            {loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {loading ? 'Processando...' : 'Confirmar baixa manual'}
          </Button>
        </>
      )}
    </form>
  );
});

export default ProductionTagInput;

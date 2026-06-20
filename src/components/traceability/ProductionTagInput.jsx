import { forwardRef, useEffect, useState } from 'react';
import { Barcode, CheckCircle2, Keyboard, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ProductionTagInput = forwardRef(function ProductionTagInput({ mode, value, onChange, onSubmit, onBlur, loading, ready = true }, ref) {
  const [confirmed, setConfirmed] = useState(false);
  const manual = mode === 'manual';

  useEffect(() => {
    if (!manual || !value) setConfirmed(false);
  }, [manual, value]);

  const submit = (event) => {
    event.preventDefault();
    if (!ready || (manual && !confirmed)) return;
    onSubmit?.({ confirmed: manual ? confirmed : true });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="relative">
        {manual
          ? <Keyboard className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-muted-foreground" />
          : <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-[#2d9c4a]" />}
        <Input
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder="Leia o código de barras, QR Code ou informe a tag produtiva"
          autoComplete="off"
          disabled={loading}
          className="h-16 sm:h-20 pl-14 pr-4 text-base sm:text-xl font-semibold bg-background border-2 border-border focus:border-[#2d9c4a] rounded-md"
          aria-label="Identificação produtiva"
        />
      </div>

      {manual && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="w-4 h-4 accent-[#00522d]" />
          Confirmo que conferi a identificação digitada.
        </label>
      )}

      <Button type="submit" disabled={!ready || loading || !value.trim() || (manual && !confirmed)} className="w-full sm:w-auto h-11 gap-2">
        {loading ? <Loader2 className="animate-spin" /> : manual ? <CheckCircle2 /> : <Send />}
        {loading ? 'Processando...' : manual ? 'Confirmar baixa manual' : 'Processar leitura'}
      </Button>
    </form>
  );
});

export default ProductionTagInput;

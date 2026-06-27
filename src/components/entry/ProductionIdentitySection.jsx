import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveProductionContext, productionContextToEntryFields } from '@/lib/productionLookupService';

const PRIMARY_FIELDS = [
  { key: 'order_number', label: 'Pedido', hint: 'order', placeholder: 'Número do pedido' },
  { key: 'lot_code', label: 'Lote', hint: 'lot', placeholder: 'Código do lote' },
  { key: 'load_number', label: 'Carga', hint: 'load', placeholder: 'Número da carga' },
  { key: 'pallet_number', label: 'Pallet', hint: 'pallet', placeholder: 'Número do pallet' },
];

const DETAIL_FIELDS = [
  { key: 'customer_trade_name', label: 'Cliente' },
  { key: 'customer_legal_name', label: 'Razão Social' },
  { key: 'product_name', label: 'Produto' },
  { key: 'route_name', label: 'Roteiro' },
  { key: 'finalization_date', label: 'Finalização', type: 'date' },
];

const FIELD_CLASS = 'grid gap-2 min-w-0';
const LABEL_CLASS = 'flex min-h-5 items-center text-xs font-semibold leading-none text-muted-foreground';
const INPUT_CLASS = 'h-11 rounded-xl text-sm';

export default function ProductionIdentitySection({ value, onChange, idPrefix = 'identity' }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(value.traceability_status === 'resolved' ? 'resolved' : 'idle');
  const [warnings, setWarnings] = useState([]);

  const set = (key, nextValue) => {
    setStatus('idle');
    setWarnings([]);
    onChange({ ...value, [key]: nextValue });
  };

  const resolve = async (explicitKey) => {
    if (loading) return;
    const primary = explicitKey
      ? PRIMARY_FIELDS.find((field) => field.key === explicitKey)
      : PRIMARY_FIELDS.find((field) => String(value[field.key] || '').trim());
    if (!primary || !String(value[primary.key] || '').trim()) {
      setStatus('limited');
      setWarnings(['Informe Pedido, Lote, Carga ou Pallet para buscar o contexto.']);
      return;
    }
    setLoading(true);
    try {
      const context = await resolveProductionContext({ value: value[primary.key], type: primary.hint });
      if (context.contextFound) {
        onChange({ ...value, ...productionContextToEntryFields(context), _productionContext: context });
        setStatus('resolved');
      } else {
        onChange({ ...value, traceability_status: 'limited', _productionContext: null });
        setStatus('limited');
      }
      setWarnings(context.warnings || []);
    } catch (error) {
      setStatus('limited');
      setWarnings([error.message || 'Não foi possível consultar o contexto produtivo.']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border-y border-border/70 py-5 space-y-4" aria-label="Identificação do Pedido">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Identificação do Pedido</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Informe apenas Pedido, Lote, Carga ou Pallet para preencher o restante.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => resolve()} disabled={loading} className="gap-2 shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar contexto
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {PRIMARY_FIELDS.map((field) => (
          <div key={field.key} className={FIELD_CLASS}>
            <Label htmlFor={`${idPrefix}-${field.key}`} className={LABEL_CLASS}>{field.label}</Label>
            <Input
              id={`${idPrefix}-${field.key}`}
              value={value[field.key] || ''}
              onChange={(event) => set(field.key, event.target.value)}
              onBlur={() => value[field.key] && resolve(field.key)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); resolve(field.key); } }}
              placeholder={field.placeholder}
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {DETAIL_FIELDS.map((field) => (
          <div key={field.key} className={FIELD_CLASS}>
            <Label htmlFor={`${idPrefix}-${field.key}`} className={LABEL_CLASS}>{field.label}</Label>
            <Input id={`${idPrefix}-${field.key}`} type={field.type || 'text'} value={value[field.key] || ''} onChange={(event) => set(field.key, event.target.value)} className={INPUT_CLASS} />
          </div>
        ))}
      </div>

      {status === 'resolved' && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" /> Contexto produtivo localizado e vinculado ao apontamento.
        </div>
      )}
      {(status === 'limited' || warnings.length > 0) && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{warnings.join(' ') || 'Contexto não localizado. O apontamento será salvo com rastreabilidade limitada.'}</span>
        </div>
      )}
    </section>
  );
}

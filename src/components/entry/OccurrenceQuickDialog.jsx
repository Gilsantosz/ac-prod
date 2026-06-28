import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';

const REASONS = [
  'Falta de Material',
  'Manutenção Corretiva',
  'Manutenção Preventiva',
  'Setup / Troca',
  'Falta de Operador',
  'Qualidade / Refugo',
  'Medida Incorreta',
  'Falha de Acabamento',
  'Falha de Colagem',
  'Falha de Furação',
  'Falha de Marcenaria',
  'Falta de Energia',
  'Baixa Produtividade',
  'Outros'
];

const SEVERITIES = [
  { value: 'low',      label: 'Baixa',    color: 'text-sky-600' },
  { value: 'medium',   label: 'Média',    color: 'text-amber-600' },
  { value: 'high',     label: 'Alta',     color: 'text-orange-600' },
  { value: 'critical', label: 'Crítica',  color: 'text-red-600' },
];

export default function OccurrenceQuickDialog({
  open = false,
  onOpenChange = null,
  suggestion = null,
  onSubmit = null,
  loading = false
}) {
  const [reason, setReason] = useState('Outros');
  const [downtime, setDowntime] = useState(0);
  const [notes, setNotes] = useState('');
  const [severity, setSeverity] = useState('medium');

  // Sincronizar dados sugeridos quando abrir
  useEffect(() => {
    if (suggestion) {
      setReason(suggestion.reason || 'Outros');
      setDowntime(suggestion.downtime || 0);
      setNotes(suggestion.notes || '');
      setSeverity(suggestion.severity || 'medium');
    }
  }, [suggestion, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!onSubmit) return;

    onSubmit({
      ...suggestion,
      reason,
      severity,
      downtime: Number(downtime) || 0,
      notes: notes.trim(),
      // Campos de rastreabilidade (preservar do suggestion)
      stage_reading_id: suggestion?.stage_reading_id || suggestion?.readingId || null,
      tag_value:         suggestion?.tag_value || suggestion?.tagValue || null,
      lot_id:            suggestion?.lot_id || suggestion?.lotId || null,
      lot_code:          suggestion?.lot_code || suggestion?.lotCode || null,
      production_order_id: suggestion?.production_order_id || suggestion?.productionOrderId || null,
    });
  };

  if (!suggestion) return null;

  const isScrap = suggestion.type === 'quality';
  const isDowntime = suggestion.type === 'downtime';
  const isReading = !!suggestion.stage_reading_id || !!suggestion.readingId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            {isScrap ? (
              <>
                <AlertOctagon className="w-5 h-5 text-red-500" />
                Registrar Ocorrência de Qualidade / Refugo
              </>
            ) : isDowntime ? (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Registrar Ocorrência de Parada
              </>
            ) : (
              <>
                <HelpCircle className="w-5 h-5 text-sky-500" />
                Registrar Baixa Produtividade
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Um evento operacional fora do esperado exige justificativa para auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">

          {/* Informações preenchidas */}
          <div className="bg-secondary/40 rounded-xl p-3 text-xs space-y-1.5 border border-border/40">
            <div className="grid grid-cols-2 gap-2">
              <p className="min-w-0"><span className="text-muted-foreground">Célula:</span> <strong className="text-foreground font-semibold break-words">{suggestion.cell || suggestion.cell_name || '—'}</strong></p>
              <p className="min-w-0"><span className="text-muted-foreground">Turno:</span> <strong className="text-foreground font-semibold break-words">{suggestion.shift || '—'}</strong></p>
              <p className="min-w-0"><span className="text-muted-foreground">Data:</span> <strong className="text-foreground font-semibold break-words">{suggestion.date || '—'}</strong></p>
              <p className="min-w-0"><span className="text-muted-foreground">Operador:</span> <strong className="text-foreground font-semibold break-words">{suggestion.operator || '—'}</strong></p>
            </div>

            {/* Rastreabilidade */}
            {(suggestion.tag_value || suggestion.tagValue || suggestion.lot_code || suggestion.lotCode) && (
              <div className="pt-1.5 border-t border-border/50 grid grid-cols-2 gap-2">
                {(suggestion.tag_value || suggestion.tagValue) && (
                  <p><span className="text-muted-foreground">Tag:</span> <strong className="font-mono">{suggestion.tag_value || suggestion.tagValue}</strong></p>
                )}
                {(suggestion.lot_code || suggestion.lotCode) && (
                  <p><span className="text-muted-foreground">Lote:</span> <strong>{suggestion.lot_code || suggestion.lotCode}</strong></p>
                )}
              </div>
            )}

            {suggestion.quantity > 0 && (
              <p className="pt-1 border-t border-border/50 text-red-600 dark:text-red-400 font-bold">
                Quantidade Afetada: {suggestion.quantity} peça(s)
              </p>
            )}
          </div>

          {/* Severidade */}
          <div className="grid gap-2">
            <Label className="text-xs font-bold text-muted-foreground">Severidade</Label>
            <div className="flex gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    severity === s.value
                      ? `${s.color} bg-secondary border-current`
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div className="grid gap-2 min-w-0">
            <Label htmlFor="occurrence-reason" className="flex min-h-5 items-center text-xs font-bold leading-none text-muted-foreground">Motivo / Causa Raiz</Label>
            <select
              id="occurrence-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium leading-none text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              required
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Tempo de Parada */}
          {(isDowntime || !isScrap) && (
            <div className="grid gap-2 min-w-0">
              <Label htmlFor="occurrence-downtime" className="flex min-h-5 items-center text-xs font-bold leading-none text-muted-foreground">Tempo de Parada (minutos)</Label>
              <Input
                id="occurrence-downtime"
                type="number"
                min="0"
                value={downtime}
                onChange={(e) => setDowntime(Math.max(0, parseInt(e.target.value) || 0))}
                className="h-11 rounded-xl text-sm"
                required
              />
            </div>
          )}

          {/* Observações */}
          <div className="grid gap-2 min-w-0">
            <Label htmlFor="occurrence-notes" className="flex min-h-5 items-center text-xs font-bold leading-none text-muted-foreground">Detalhamento / Ação Corretiva</Label>
            <Textarea
              id="occurrence-notes"
              placeholder="Descreva o que ocorreu e a ação imediata..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-sm resize-none rounded-md"
              required
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange?.(false)}
              disabled={loading}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading}
              className="text-xs font-semibold bg-[#2d9c4a] hover:bg-[#237d3a] text-white"
            >
              {loading ? 'Salvando...' : 'Confirmar Ocorrência'}
            </Button>
          </DialogFooter>

        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, AlertOctagon, HelpCircle, ArrowRight } from 'lucide-react';

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

  // Sincronizar dados sugeridos quando abrir
  useEffect(() => {
    if (suggestion) {
      setReason(suggestion.reason || 'Outros');
      setDowntime(suggestion.downtime || 0);
      setNotes(suggestion.notes || '');
    }
  }, [suggestion, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    
    onSubmit({
      ...suggestion,
      reason,
      downtime: Number(downtime) || 0,
      notes: notes.trim()
    });
  };

  if (!suggestion) return null;

  const isScrap = suggestion.type === 'quality';
  const isDowntime = suggestion.type === 'downtime';
  const isLowEfficiency = suggestion.type === 'low_efficiency';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] rounded-2xl">
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
              <p><span className="text-muted-foreground">Célula:</span> <strong className="text-foreground font-semibold">{suggestion.cell}</strong></p>
              <p><span className="text-muted-foreground">Turno:</span> <strong className="text-foreground font-semibold">{suggestion.shift}</strong></p>
              <p><span className="text-muted-foreground">Data:</span> <strong className="text-foreground font-semibold">{suggestion.date}</strong></p>
              <p><span className="text-muted-foreground">Operador:</span> <strong className="text-foreground font-semibold">{suggestion.operator}</strong></p>
            </div>
            {suggestion.quantity > 0 && (
              <p className="pt-1 border-t border-border/50 text-red-600 dark:text-red-400 font-bold">
                Quantidade Afetada: {suggestion.quantity} peça(s)
              </p>
            )}
          </div>

          {/* Seleção do Motivo */}
          <div className="space-y-1.5">
            <Label htmlFor="occurrence-reason" className="text-xs font-bold text-muted-foreground">Motivo / Causa Raiz</Label>
            <select
              id="occurrence-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              required
            >
              {REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Tempo de Parada */}
          {(isDowntime || !isScrap) && (
            <div className="space-y-1.5">
              <Label htmlFor="occurrence-downtime" className="text-xs font-bold text-muted-foreground">Tempo de Parada (minutos)</Label>
              <Input
                id="occurrence-downtime"
                type="number"
                min="0"
                value={downtime}
                onChange={(e) => setDowntime(Math.max(0, parseInt(e.target.value) || 0))}
                className="h-10 text-sm"
                required
              />
            </div>
          )}

          {/* Observações / Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="occurrence-notes" className="text-xs font-bold text-muted-foreground">Detalhamento / Ação Corretiva</Label>
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

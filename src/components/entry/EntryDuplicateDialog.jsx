import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Plus, Replace, ClipboardList, X } from 'lucide-react';

function formatHour(hour) {
  if (!hour) return '—';
  return String(hour).includes(':') ? hour : `${hour}:00`;
}

export default function EntryDuplicateDialog({
  open = false,
  onOpenChange = null,
  duplicateEntry = null,
  userRole = 'operator',
  onResolve = null // Recebe o tipo de resolução: 'sum', 'replace', 'new', 'cancel'
}) {

  if (!duplicateEntry) return null;

  const isManager = userRole === 'manager';
  const isAdmin = userRole === 'admin';

  // Permissões
  const canReplace = isAdmin || isManager;
  const canRegisterNewSeparated = isAdmin || isManager;
  const displayHour = formatHour(duplicateEntry.hour);

  const handleResolve = (action) => {
    if (!onResolve) return;
    onResolve(action);
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-amber-600 dark:text-amber-500">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            Lançamento Duplicado Detectado
          </DialogTitle>
          <DialogDescription className="text-xs">
            Já existe um registro de produção nesta hora ({displayHour}) com os mesmos dados de rastreabilidade (Lote/OP/Etapa).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Detalhes do registro existente */}
          <div className="bg-secondary/40 border border-border/50 rounded-xl p-3.5 text-xs space-y-2">
            <h4 className="font-bold text-foreground">Registro Existente no Sistema:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
              <p className="min-w-0">Lote: <strong className="font-mono text-foreground break-all">{duplicateEntry.lot_code || 'SEM_LOTE'}</strong></p>
              <p className="min-w-0">OP: <strong className="font-mono text-foreground break-all">{duplicateEntry.order_number || 'MANUAL'}</strong></p>
              <p className="min-w-0">Hora: <strong className="text-foreground break-words">{displayHour}</strong></p>
              <p className="min-w-0">Etapa: <strong className="text-foreground break-words">{duplicateEntry.process_step || 'Apontamento Manual'}</strong></p>
              <p className="min-w-0">Produzido: <strong className="text-sm font-bold text-emerald-600">+{duplicateEntry.produced}</strong></p>
              <p className="min-w-0">Refugo: <strong className="text-sm font-bold text-red-500">-{duplicateEntry.scrap || 0}</strong></p>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1.5 border-t border-border/40 break-words">
              Registrado por: {duplicateEntry.operator}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Escolha como deseja resolver essa duplicidade com base nas suas permissões de acesso:
          </p>

          <div className="flex flex-col gap-2">
            
            {/* Opção 1: Somar */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleResolve('sum')}
              className="h-14 flex items-center justify-start gap-3 text-left px-4 rounded-xl border-border/80 hover:bg-secondary/60 hover:text-foreground"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-tight">Somar ao apontamento existente</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Adiciona a nova quantidade ao registro anterior.</p>
              </div>
            </Button>

            {/* Opção 2: Substituir */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleResolve('replace')}
              disabled={!canReplace}
              className="h-14 flex items-center justify-start gap-3 text-left px-4 rounded-xl border-border/80 hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
                <Replace className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                  Substituir valor
                  {!canReplace && <Badge variant="secondary" className="text-[8px] px-1 py-0 scale-90">Gestão/Admin</Badge>}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Sobrescreve o registro anterior com os novos dados.</p>
              </div>
            </Button>

            {/* Opção 3: Registrar Separado */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleResolve('new')}
              disabled={!canRegisterNewSeparated}
              className="h-14 flex items-center justify-start gap-3 text-left px-4 rounded-xl border-border/80 hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
                <ClipboardList className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                  Registrar novo apontamento separado
                  {!canRegisterNewSeparated && <Badge variant="secondary" className="text-[8px] px-1 py-0 scale-90">Gestão/Admin</Badge>}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Gera uma nova linha paralela no banco para a mesma hora.</p>
              </div>
            </Button>

          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 border-t border-border/50 pt-3">
          <Button 
            type="button" 
            variant="ghost" 
            size="sm"
            onClick={() => handleResolve('cancel')}
            className="text-xs gap-1.5 w-full sm:w-auto"
          >
            <X className="w-4 h-4 text-red-500" />
            Cancelar Lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

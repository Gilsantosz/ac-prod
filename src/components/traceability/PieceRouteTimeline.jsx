import { Check, Circle, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

const LABELS = {
  imported: 'Importado', released: 'Liberado', cut: 'Corte', edge: 'Bordo', cnc: 'Usinagem',
  joinery: 'Marcenaria', separation: 'Separação', packaging: 'Embalagem',
  waiting_shipping: 'Aguardando envio', shipping: 'Expedição', completed: 'Finalizado',
};

export default function PieceRouteTimeline({ route = [], currentStep }) {
  const steps = [...route].filter((step) => step.required !== false).sort((a, b) => a.step_order - b.step_order);
  if (!steps.length) return <div className="border border-dashed rounded-md p-8 text-center text-muted-foreground">A rota produtiva aparecerá após a leitura.</div>;
  const currentIndex = steps.findIndex((step) => step.step_name === currentStep);

  return (
    <div className="bg-card border border-border rounded-md p-5">
      <h3 className="font-semibold mb-4">Rota produtiva da peça</h3>
      <div className="space-y-0">
        {steps.map((step, index) => {
          const complete = currentIndex < 0 || index < currentIndex;
          const current = index === currentIndex;
          return (
            <div key={step.id || `${step.step_order}-${step.step_name}`} className="flex gap-3 min-h-14">
              <div className="flex flex-col items-center">
                <div className={cn('w-7 h-7 rounded-full border flex items-center justify-center shrink-0', complete ? 'bg-emerald-600 border-emerald-600 text-white' : current ? 'bg-amber-100 border-amber-500 text-amber-700' : 'bg-card border-border text-muted-foreground')}>
                  {complete ? <Check className="w-4 h-4" /> : <Circle className="w-3 h-3" />}
                </div>
                {index < steps.length - 1 && <div className={cn('w-px flex-1', complete ? 'bg-emerald-400' : 'bg-border')} />}
              </div>
              <div className="pb-4 min-w-0">
                <p className={cn('text-sm font-semibold', current && 'text-amber-700 dark:text-amber-400')}>{LABELS[step.step_name] || step.step_name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {step.cell_name || 'Célula não vinculada'}{current ? ' · etapa atual' : ''}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

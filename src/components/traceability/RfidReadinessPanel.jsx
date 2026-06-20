import { RadioTower, Settings2, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RfidReadinessPanel({ active = false }) {
  return (
    <div className="border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/20 rounded-md p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-md bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0">{active ? <Waves /> : <RadioTower />}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">Preparado para RFID</p>
        <p className="text-xs text-muted-foreground mt-1">Arquitetura pronta para EPC, TID, leitor fixo, leitor manual, antenas e leitura em massa. A comunicação com hardware será ativada futuramente.</p>
      </div>
      <Button variant="outline" size="icon" disabled title="Configuração disponível após instalar o gateway RFID"><Settings2 /></Button>
    </div>
  );
}

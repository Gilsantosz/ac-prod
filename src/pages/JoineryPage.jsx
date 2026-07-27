import { useOperatorSession } from '@/hooks/useOperatorSession';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import JoineryWorkbench from '@/components/traceability/JoineryWorkbench';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';
import { useTraceability } from '@/hooks/useTraceability';
import { Wrench, LogOut } from 'lucide-react';

export default function JoineryPage() {
  const trace = useTraceability();
  const { isLoggedIn, logout } = useOperatorSession();

  if (!isLoggedIn) {
    return (
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <OperationalLoginGate
          pageTitle="Marcenaria"
          pageSubtitle="BANCADA OPERACIONAL DE MARCENARIA"
          pageDescription="Identificação do operador para início do trabalho na bancada de Marcenaria."
          icon={Wrench}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Marcenaria"
        subtitle="Bancada operacional de Marcenaria — gestão de peças, lotes e fluxo produtivo manual."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="rounded-xl border-emerald-500/30 hover:bg-emerald-500/10 text-foreground gap-2 h-9"
            >
              <LogOut className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Trocar Operador</span>
            </Button>
          </div>
        }
      />
      <JoineryWorkbench trace={trace} />
    </div>
  );
}

import PageHeader from '@/components/ui/PageHeader';
import JoineryWorkbench from '@/components/traceability/JoineryWorkbench';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';
import { useTraceability } from '@/hooks/useTraceability';
import { Wrench } from 'lucide-react';

export default function JoineryPage() {
  const trace = useTraceability();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Marcenaria"
        subtitle="Bancada operacional de Marcenaria — gestão de peças, lotes e fluxo produtivo manual."
        icon={Wrench}
      />
      <OperationalLoginGate>
        <JoineryWorkbench trace={trace} />
      </OperationalLoginGate>
    </div>
  );
}

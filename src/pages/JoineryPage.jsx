import PageHeader from '@/components/ui/PageHeader';
import JoineryWorkbench from '@/components/traceability/JoineryWorkbench';
import { Wrench } from 'lucide-react';

export default function JoineryPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Marcenaria"
        subtitle="Consulta de peças, status e andamento produtivo."
        icon={Wrench}
      />
      <JoineryWorkbench />
    </div>
  );
}

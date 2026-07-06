import PageHeader from '@/components/ui/PageHeader';
import OperationalAlertsPanel from '@/components/traceability/OperationalAlertsPanel';
import { BellRing } from 'lucide-react';

export default function MesAlertsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Alertas MES Chão de Fábrica"
        subtitle="Monitore atrasos, paradas de postos e anomalias físicas na produção de móveis em tempo real."
        icon={BellRing}
      />
      <div className="bg-card border border-border/60 rounded-2xl p-4 sm:p-6 shadow-sm">
        <OperationalAlertsPanel />
      </div>
    </div>
  );
}

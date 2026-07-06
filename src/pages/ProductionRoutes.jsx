import PageHeader from '@/components/ui/PageHeader';
import RouteTemplatesManager from '@/components/routing/RouteTemplatesManager';
import { GitFork } from 'lucide-react';

export default function ProductionRoutes() {
  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Rotas Produtivas MES"
        subtitle="Gerenciamento de roteiros de fabricação, fluxos sequenciais e vinculação de etapas produtivas."
        icon={GitFork}
      />
      <div className="bg-card border border-border/60 rounded-2xl p-4 sm:p-6 shadow-sm">
        <RouteTemplatesManager />
      </div>
    </div>
  );
}

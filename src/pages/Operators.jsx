import { HardHat } from 'lucide-react';
import OperatorsManager from '@/components/operators/OperatorsManager';
import PageHeader from '@/components/ui/PageHeader';

export default function Operators() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Operadores"
        subtitle="Cadastre colaboradores, associe-os a células e defina o turno de trabalho."
        icon={HardHat}
      />

      <OperatorsManager />
    </div>
  );
}

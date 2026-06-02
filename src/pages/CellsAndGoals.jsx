import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Boxes, Target, Users, CalendarRange } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import CellsManager from '@/components/cells/CellsManager';
import GoalsManager from '@/components/goals/GoalsManager';
import MonthlyGoalsManager from '@/components/monthlygoals/MonthlyGoalsManager';
import ManagersManager from '@/components/managers/ManagersManager';

export default function CellsAndGoals() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Células e Metas"
        subtitle="Cadastre as células e suas horas por turno, e defina as metas diárias de produção."
        icon={Boxes}
      />

      <Tabs defaultValue="cells" className="space-y-6">
        <TabsList>
          <TabsTrigger value="cells" className="gap-2"><Boxes className="w-4 h-4" /> Células</TabsTrigger>
          <TabsTrigger value="monthly" className="gap-2"><CalendarRange className="w-4 h-4" /> Configuração de Metas</TabsTrigger>
          <TabsTrigger value="goals" className="gap-2"><Target className="w-4 h-4" /> Metas Diárias</TabsTrigger>
          <TabsTrigger value="managers" className="gap-2"><Users className="w-4 h-4" /> Gestores</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly">
          <MonthlyGoalsManager />
        </TabsContent>

        <TabsContent value="cells">
          <CellsManager />
        </TabsContent>
        <TabsContent value="goals">
          <GoalsManager />
        </TabsContent>
        <TabsContent value="managers">
          <ManagersManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
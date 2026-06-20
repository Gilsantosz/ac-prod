import { PenLine, FileText, Barcode, History } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ManualProductionTabs() {
  return (
    <TabsList className="bg-card border border-border/60 h-auto p-1 flex-wrap gap-1 grid grid-cols-2 md:inline-flex w-full md:w-auto">
      <TabsTrigger value="quick" className="h-10 gap-2 text-xs sm:text-sm">
        <PenLine className="w-4 h-4 text-[#2d9c4a]" />
        Manual Rápido
      </TabsTrigger>
      
      <TabsTrigger value="complete" className="h-10 gap-2 text-xs sm:text-sm">
        <FileText className="w-4 h-4 text-[#2d9c4a]" />
        Manual Completo
      </TabsTrigger>
      
      <TabsTrigger value="collection" className="h-10 gap-2 text-xs sm:text-sm">
        <Barcode className="w-4 h-4 text-[#2d9c4a]" />
        Coleta Código / RFID
      </TabsTrigger>
      
      <TabsTrigger value="history" className="h-10 gap-2 text-xs sm:text-sm">
        <History className="w-4 h-4 text-[#2d9c4a]" />
        Histórico Recente
      </TabsTrigger>
    </TabsList>
  );
}

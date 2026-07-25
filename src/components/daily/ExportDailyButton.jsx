import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { FileDown, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportDailySummaryPdf, exportDailySummaryExcel } from '@/lib/exportDailySummary';

export default function ExportDailyButton({ date, shift, cell, summary, cells = [], disabled = false }) {
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingExcel, setLoadingExcel] = useState(false);

  const handleExportPdf = async () => {
    setLoadingPdf(true);
    try {
      await exportDailySummaryPdf({ date, shift, cell, summary, cells });
      toast.success('Relatório PDF gerado com sucesso.');
    } catch (error) {
      toast.error(error?.message || 'Falha ao gerar o relatório PDF.');
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    setLoadingExcel(true);
    try {
      await exportDailySummaryExcel({ date, shift, cell, summary, cells });
      toast.success('Planilha Excel gerada com sucesso.');
    } catch (error) {
      toast.error(error?.message || 'Falha ao gerar a planilha Excel.');
    } finally {
      setLoadingExcel(false);
    }
  };

  const isLoading = loadingPdf || loadingExcel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={disabled || isLoading}
          className="gap-2 bg-[#1A2238] hover:bg-[#111728] text-white font-bold rounded-xl h-10 px-5 shadow-sm text-xs"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          <span>Exportar Relatório</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-xl bg-card border-border">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground uppercase tracking-wider px-2 py-1 font-bold">
          Formato do Relatório
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleExportPdf}
          disabled={loadingPdf}
          className="gap-2.5 text-xs font-semibold py-2 cursor-pointer rounded-lg hover:bg-muted"
        >
          <FileDown className="w-4 h-4 text-red-500 shrink-0" />
          <div className="flex flex-col">
            <span>Relatório PDF</span>
            <span className="text-[10px] text-muted-foreground font-normal">Com Célula, Turno e Unidade</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleExportExcel}
          disabled={loadingExcel}
          className="gap-2.5 text-xs font-semibold py-2 cursor-pointer rounded-lg hover:bg-muted"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex flex-col">
            <span>Planilha Excel (.xlsx)</span>
            <span className="text-[10px] text-muted-foreground font-normal">Planilhas e abas detalhadas</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

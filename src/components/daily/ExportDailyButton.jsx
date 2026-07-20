import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportDailySummaryPdf } from '@/lib/exportDailySummary';

export default function ExportDailyButton({ date, shift, cell, summary, disabled }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      await exportDailySummaryPdf({ date, shift, cell, summary });
      toast.success('Relatório PDF gerado.');
    } catch {
      toast.error('Falha ao gerar o relatório.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={disabled || loading}
      className="gap-2 bg-[#1A2238] hover:bg-[#111728] text-white font-bold rounded-xl h-10 px-5 shadow-sm text-xs"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
      Exportar Relatório
    </Button>
  );
}
